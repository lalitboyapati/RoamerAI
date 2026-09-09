/// <reference lib="webworker" />
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import type { IndexMeta, ModelId, WorkerIn, WorkerOut } from "./types";

/**
 * The search engine, in a worker.
 *
 * There is no server. The corpus is 59,168 short descriptions that never
 * change, so the whole index ships as static files next to the page: the
 * descriptions as JSON, the vectors as an int8 matrix, and the sentence
 * encoder as ONNX. Everything below runs off the main thread because the
 * scene has a 55 fps floor and a 22-million-multiply scan would blow it.
 *
 * Nothing here is fetched from a third party at runtime — the model and the
 * WebAssembly backend are served from this origin, so the page keeps working
 * whatever happens to anyone else's CDN.
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

const MODEL = "Xenova/all-MiniLM-L6-v2";
/** Cosine floor for "this feature responds to the concept" — the cutoff the
 *  Typesense preset used (distance_threshold 0.70), kept so verdicts move for
 *  the same reasons they did before. */
const FLOOR = 0.3;
/** The scene draws one sphere per hit; this is the budget that holds 55 fps. */
const MAX_HITS = 250;

let meta: IndexMeta;
let docs: Record<ModelId, [number, number, string][]>;
let vecs: Int8Array;
let extract: FeatureExtractionPipeline;
let ready = false;

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

/** fetch with progress, so the first visit can show something true */
async function load(url: string, phase: "index" | "model"): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} — ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    post({ type: "progress", phase, loaded, total });
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}

async function init() {
  meta = await (await fetch("/idx/meta.json")).json();
  docs = JSON.parse(new TextDecoder().decode(await load("/idx/docs.json", "index")));
  vecs = new Int8Array(await load("/idx/vecs.i8", "index"));
  post({ type: "phase", phase: "model" });
  extract = await pipeline("feature-extraction", MODEL, {
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
  post({ type: "ready" });
}

async function embed(text: string): Promise<Float32Array> {
  const t = await extract(text, { pooling: "mean", normalize: true });
  return t.data as Float32Array;
}

interface Scored {
  row: number;
  score: number;
}

/** One pass over a model's slice: total above the floor, per-layer counts, top hits. */
function scan(q: Float32Array, model: ModelId) {
  const { offset, count } = meta.models[model];
  const dims = meta.dims;
  const scale = meta.scale;
  const rows = docs[model];

  let found = 0;
  const perLayer: Record<number, number> = {};
  // a small max-heap would be tidier; for 250 of 59k an insertion floor is faster
  const top: Scored[] = [];
  let worst = -1;

  for (let i = 0; i < count; i++) {
    const base = (offset + i) * dims;
    let dot = 0;
    for (let d = 0; d < dims; d++) dot += q[d] * vecs[base + d];
    const score = dot * scale;
    if (score < FLOOR) continue;
    found++;
    const layer = rows[i][0];
    perLayer[layer] = (perLayer[layer] ?? 0) + 1;
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

  const hits = top.map((t) => {
    const [layer, index, description] = rows[t.row];
    return { layer, index, description, score: t.score };
  });
  // the scene wants each hit's vector for its own PCA and clustering
  const embeddings = top.map((t) => {
    const base = (offset + t.row) * dims;
    const v = new Array<number>(dims);
    for (let d = 0; d < dims; d++) v[d] = vecs[base + d] * scale;
    return v;
  });

  return { found, perLayer, hits, embeddings };
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      await init();
      return;
    }
    if (!ready) throw new Error("index still loading");
    const t0 = performance.now();
    const q = await embed(msg.q);
    const results = Object.fromEntries(msg.models.map((m) => [m, scan(q, m)]));
    post({ type: "result", id: msg.id, results, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    post({ type: "error", id: "id" in msg ? msg.id : undefined, message: String(err) });
  }
};
