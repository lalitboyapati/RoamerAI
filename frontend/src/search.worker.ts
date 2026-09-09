/// <reference lib="webworker" />
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import type { Catalog, ModelHits, ModelId, WorkerIn, WorkerOut } from "./types";

/**
 * The search engine, in a worker.
 *
 * There is no server. Each model's descriptions and int8 vectors are static
 * files under /idx/<model>/, loaded only when that model is actually being
 * compared, so picking two of three costs two of three. Scoring runs off the
 * main thread because the scene has a 55 fps floor and a full scan is tens of
 * millions of multiplies.
 *
 * Nothing is fetched from a third party at runtime — the encoder and the
 * WebAssembly backend are served from this origin.
 */
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
// Served from public/ort. Left to itself onnxruntime fetches its binary from a
// public CDN at runtime, which would make every search depend on someone else's
// uptime; the package does not export the loader path for the bundler to take
// it, so the two files are copied in and pinned here instead.
env.backends.onnx.wasm!.wasmPaths = "/ort/";
env.backends.onnx.wasm!.numThreads = 1;

const ENCODER = "Xenova/all-MiniLM-L6-v2";
/** Cosine floor for "this feature responds to the concept". */
const FLOOR = 0.3;
/** The scene draws one sphere per hit; this is the budget that holds 55 fps. */
const MAX_HITS = 250;
/** Bumped when the files change shape, so an old copy is never read as a new one. */
const CACHE = "romirai-idx-v2";

interface Loaded {
  rows: [number, number, string][];
  vecs: Int8Array;
  scale: number;
  nLayers: number;
  count: number;
}

let catalog: Catalog;
let extract: FeatureExtractionPipeline;
const loaded = new Map<ModelId, Loaded>();
let restored = false;
let ready = false;
/** self.onmessage is re-entered per message, so everything queues behind this. */
let booting: Promise<void> | null = null;

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

/** Read a response body, reporting real bytes as they land. */
async function drain(res: Response, phase: "index" | "model"): Promise<ArrayBuffer> {
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const chunks: Uint8Array[] = [];
  let at = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    at += value.length;
    post({ type: "progress", phase, loaded: at, total });
  }
  const out = new Uint8Array(at);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out.buffer;
}

/**
 * Fetch once, keep it.
 *
 * The index goes into the Cache API rather than being left to the HTTP cache,
 * which the browser evicts whenever it likes and which refuses to write a single
 * entry larger than an eighth of itself — exactly how a 12 MB matrix fails with
 * ERR_CACHE_WRITE_FAILURE. `no-store` keeps it out of that path entirely.
 */
async function load(url: string, phase: "index" | "model"): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
  } catch {
    cache = null; // private windows and locked-down browsers have no Cache API
  }
  const hit = await cache?.match(url);
  if (hit) {
    restored = true;
    post({ type: "phase", phase, restored: true });
    return drain(hit, phase);
  }
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} — ${res.status}`);
  const buf = await drain(res, phase);
  try {
    await cache?.put(url, new Response(buf.slice(0), { headers: { "content-length": String(buf.byteLength) } }));
  } catch {
    // out of quota, or the browser said no; the app still works, it just pays again
  }
  return buf;
}

async function loadModel(id: ModelId) {
  if (loaded.has(id)) return;
  const m = catalog.models[id];
  if (!m) throw new Error(`unknown model ${id}`);
  const rows = JSON.parse(new TextDecoder().decode(await load(`/idx/${id}/docs.json`, "index")));
  const vecs = new Int8Array(await load(`/idx/${id}/vecs.i8`, "index"));
  loaded.set(id, { rows, vecs, scale: m.scale, nLayers: m.nLayers, count: rows.length });
}

async function init(models: ModelId[]) {
  // Without this the browser may evict everything below under storage pressure,
  // and a returning visitor silently pays the download again.
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not available; nothing to do about it */
  }
  catalog = await (await fetch("/idx/catalog.json")).json();
  for (const id of models) await loadModel(id);
  post({ type: "phase", phase: "model" });
  extract = await pipeline("feature-extraction", ENCODER, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p: { status?: string; loaded?: number; total?: number }) => {
      if (p.status === "progress" && p.total) {
        post({ type: "progress", phase: "model", loaded: p.loaded ?? 0, total: p.total });
      }
    },
  });
  // one warm pass so the first real query is not also the first inference
  await embed("warm up");
  ready = true;
  let persisted = false;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    /* ignore */
  }
  post({ type: "ready", restored, persisted });
}

async function embed(text: string): Promise<Float32Array> {
  const t = await extract(text, { pooling: "mean", normalize: true });
  return t.data as Float32Array;
}

/**
 * One pass over a model. Everything comparable between models is computed here:
 * density normalises the count by how much of the model is indexed, depth and
 * profile are expressed as a fraction of the network rather than a layer index,
 * and the centroid lets two models be asked whether they mean the same thing.
 */
function scan(q: Float32Array, id: ModelId): ModelHits {
  const { rows, vecs, scale, nLayers, count } = loaded.get(id)!;
  const dims = catalog.dims;

  let found = 0;
  let depthMass = 0;
  const perLayer: Record<number, number> = {};
  const centroid = new Float64Array(dims);
  const top: { row: number; score: number }[] = [];
  let worst = -1;

  for (let i = 0; i < count; i++) {
    const base = i * dims;
    let dot = 0;
    for (let d = 0; d < dims; d++) dot += q[d] * vecs[base + d];
    const score = dot * scale;
    if (score < FLOOR) continue;

    found++;
    const layer = rows[i][0];
    perLayer[layer] = (perLayer[layer] ?? 0) + 1;
    depthMass += nLayers > 1 ? layer / (nLayers - 1) : 0;
    for (let d = 0; d < dims; d++) centroid[d] += vecs[base + d] * scale;

    if (top.length < MAX_HITS) {
      top.push({ row: i, score });
      if (top.length === MAX_HITS) {
        top.sort((a, b) => a.score - b.score);
        worst = top[0].score;
      }
    } else if (score > worst) {
      top[0] = { row: i, score };
      top.sort((a, b) => a.score - b.score);
      worst = top[0].score;
    }
  }
  top.sort((a, b) => b.score - a.score);

  let norm = 0;
  for (let d = 0; d < dims; d++) norm += centroid[d] * centroid[d];
  norm = Math.sqrt(norm) || 1;
  const unit = Array.from(centroid, (v) => v / norm);

  // entropy over log(nLayers) so a 26-layer and a 32-layer model are on one scale
  let h = 0;
  for (const n of Object.values(perLayer)) {
    const p = n / Math.max(1, found);
    if (p > 0) h -= p * Math.log(p);
  }
  const spread = nLayers > 1 ? h / Math.log(nLayers) : 0;

  const profile = Array.from({ length: nLayers }, (_, L) => ({
    at: nLayers > 1 ? L / (nLayers - 1) : 0,
    share: (perLayer[L] ?? 0) / Math.max(1, found),
  }));

  const hits = top.map((t) => {
    const [layer, index, description] = rows[t.row];
    return { layer, index, description, score: t.score };
  });
  // the scene wants each hit's vector for its own PCA and clustering
  const embeddings = top.map((t) => {
    const base = t.row * dims;
    const v = new Array<number>(dims);
    for (let d = 0; d < dims; d++) v[d] = vecs[base + d] * scale;
    return v;
  });

  return {
    found,
    density: found / (count / 1000),
    depth: found ? depthMass / found : 0,
    spread,
    perLayer,
    profile,
    centroid: unit,
    hits,
    embeddings,
  };
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      booting ??= init(msg.models);
      await booting;
      return;
    }
    if (!booting) throw new Error("the index was asked to search before it was started");
    await booting;
    if (msg.type === "add") {
      for (const id of msg.models) await loadModel(id);
      post({ type: "loaded", models: [...loaded.keys()] });
      return;
    }
    if (!ready) throw new Error("index still loading");
    const t0 = performance.now();
    for (const id of msg.models) await loadModel(id);
    const q = await embed(msg.q);
    const results = Object.fromEntries(msg.models.map((m) => [m, scan(q, m)]));
    post({ type: "result", id: msg.id, results, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    post({ type: "error", id: "id" in msg ? msg.id : undefined, message: String(err) });
  }
};
