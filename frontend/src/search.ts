import type { Catalog, Feature, LoadState, ModelHits, ModelId, WorkerOut } from "./types";

/**
 * The client half of the search.
 *
 * There is no backend and no third-party call: the index and the sentence
 * encoder are static files on this origin, and the scoring happens in a worker
 * (see search.worker.ts). This module owns the conversation with it, and the
 * handful of comparisons that only make sense between two models.
 */
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { ok: (r: Record<ModelId, ModelHits>, ms: number) => void; fail: (e: Error) => void }>();

let load: LoadState = { phase: "index", loaded: 0, total: 0 };
let readyResolve: (() => void) | null = null;
let readyReject: ((e: Error) => void) | null = null;
const readyPromise = new Promise<void>((res, rej) => {
  readyResolve = res;
  readyReject = rej;
});
const listeners = new Set<(s: LoadState) => void>();

export const loadState = () => load;
export function onLoad(fn: (s: LoadState) => void) {
  listeners.add(fn);
  fn(load);
  return () => listeners.delete(fn);
}
function setLoad(next: LoadState) {
  load = next;
  for (const fn of listeners) fn(next);
}

/** The model list, fetched before anything is downloaded so the picker can render. */
let catalogPromise: Promise<Catalog> | null = null;
export function getCatalog(): Promise<Catalog> {
  catalogPromise ??= fetch("/idx/catalog.json").then((r) => {
    if (!r.ok) throw new Error(`catalog.json — ${r.status}`);
    return r.json() as Promise<Catalog>;
  });
  return catalogPromise;
}

/** Start fetching the encoder and the models named. Safe to call more than once. */
export function startSearch(models: ModelId[]) {
  if (worker) {
    worker.postMessage({ type: "add", models });
    return readyPromise;
  }
  worker = new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const m = e.data;
    if (m.type === "progress") setLoad({ ...load, phase: m.phase, loaded: m.loaded, total: m.total });
    else if (m.type === "phase")
      setLoad({ ...load, phase: m.phase, loaded: 0, total: 0, restored: m.restored ?? load.restored });
    else if (m.type === "ready") {
      setLoad({ phase: "ready", loaded: 1, total: 1, restored: m.restored, persisted: m.persisted });
      readyResolve?.();
    } else if (m.type === "result") {
      pending.get(m.id)?.ok(m.results, m.ms);
      pending.delete(m.id);
    } else if (m.type === "error") {
      const err = new Error(m.message);
      if (m.id !== undefined) {
        pending.get(m.id)?.fail(err);
        pending.delete(m.id);
      } else readyReject?.(err);
    }
  };
  worker.onerror = (e) => readyReject?.(new Error(e.message || "the search index failed to start"));
  worker.postMessage({ type: "init", models });
  return readyPromise;
}

export async function searchModels(q: string, models: ModelId[]) {
  await startSearch(models);
  const id = ++seq;
  return new Promise<{ results: Record<ModelId, ModelHits>; ms: number }>((ok, fail) => {
    pending.set(id, { ok: (results, ms) => ok({ results, ms }), fail });
    worker!.postMessage({ type: "search", id, q, models });
  });
}

/**
 * The nearest features in another model to one feature, found by searching that
 * model with this feature's own description. Nothing crosses between models
 * except meaning.
 */
export async function searchCounterpart(source: Feature, targets: ModelId[]) {
  const { results } = await searchModels(source.description, targets);
  return results;
}

export function toFeatures(r: ModelHits, model: ModelId, sourceSet: string): Feature[] {
  return r.hits.map((h) => ({
    id: `${model}_${h.layer}_${h.index}`,
    model,
    layer: h.layer,
    index: h.index,
    description: h.description,
    // reconstructed rather than stored: 59k copies of a predictable string is
    // megabytes of payload for something the catalog already determines
    npUrl: `https://www.neuronpedia.org/${model}/${h.layer}-${sourceSet}/${h.index}`,
    rel: Math.max(0, Math.min(1, h.score)),
  }));
}

export const toEmbeddings = (r: ModelHits): (number[] | undefined)[] => r.embeddings;

/* --------------------------------------------------------------- comparison */

/**
 * Do two models mean the same thing by a concept?
 *
 * Cosine between the mean embedding of everything each model matched. Concepts
 * both models hold well sit around 0.98; where one is thin they diverge, which
 * is the more interesting reading.
 */
export function centroidAgreement(a: ModelHits | undefined, b: ModelHits | undefined): number | null {
  if (!a?.centroid.length || !b?.centroid.length || !a.found || !b.found) return null;
  let dot = 0;
  for (let i = 0; i < a.centroid.length; i++) dot += a.centroid[i] * b.centroid[i];
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Below this many features, depth and spread are describing a handful of points
 * and should be shown as provisional rather than as a measurement.
 */
export const THIN = 30;

/**
 * One number for the whole first run, weighted by what the pieces actually
 * weigh over the wire. Used to draw the model as it arrives, so the wait is the
 * thing being waited for.
 */
const INDEX_SHARE = 0.48;
export function progressFraction(s: LoadState): number {
  if (s.phase === "ready") return 1;
  const within = s.total > 0 ? Math.min(1, s.loaded / s.total) : 0;
  return s.phase === "index" ? within * INDEX_SHARE : INDEX_SHARE + within * (1 - INDEX_SHARE);
}
