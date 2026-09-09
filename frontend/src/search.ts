import type { Feature, LoadState, ModelHits, ModelId, WorkerOut } from "./types";

export const otherModel = (m: ModelId): ModelId => (m === "gemma-2-2b" ? "llama3.1-8b" : "gemma-2-2b");

/**
 * The client half of the search.
 *
 * There is no backend and no third-party call: the index and the sentence
 * encoder are static files on this origin, and the scoring happens in a worker
 * (see search.worker.ts). This module only owns the conversation with it.
 *
 * One consequence worth knowing: `found` is now the true number of features
 * above the similarity floor. The hosted index used to cap its candidate pool
 * at 600, which clipped the count the coverage score is built on.
 */
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { ok: (r: Record<string, ModelHits>, ms: number) => void; fail: (e: Error) => void }>();

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

/** Start fetching the index and the encoder. Safe to call more than once. */
export function startSearch() {
  if (worker) return readyPromise;
  worker = new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const m = e.data;
    if (m.type === "progress") setLoad({ ...load, phase: m.phase, loaded: m.loaded, total: m.total });
    else if (m.type === "phase") setLoad({ ...load, phase: m.phase, loaded: 0, total: 0, restored: m.restored ?? load.restored });
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
  worker.postMessage({ type: "init" });
  return readyPromise;
}

export async function searchModels(q: string, models: ModelId[]) {
  await startSearch();
  const id = ++seq;
  return new Promise<{ results: Record<string, ModelHits>; ms: number }>((ok, fail) => {
    pending.set(id, { ok: (results, ms) => ok({ results, ms }), fail });
    worker!.postMessage({ type: "search", id, q, models });
  });
}

/**
 * The nearest features in the *other* model to one feature, found by searching
 * that model with this feature's own description. Nothing crosses between
 * models except meaning.
 */
export async function searchCounterpart(source: Feature, target: ModelId): Promise<ModelHits> {
  const { results } = await searchModels(source.description, [target]);
  return results[target];
}

export function toFeatures(r: ModelHits, model: ModelId, sourceSet: string): Feature[] {
  return r.hits.map((h) => ({
    id: `${model}_${h.layer}_${h.index}`,
    model,
    layer: h.layer,
    index: h.index,
    description: h.description,
    // reconstructed rather than stored: 59k copies of a predictable string is
    // 5 MB of payload for something the manifest already determines
    npUrl: `https://www.neuronpedia.org/${model}/${h.layer}-${sourceSet}/${h.index}`,
    rel: Math.max(0, Math.min(1, h.score)),
  }));
}

export const toEmbeddings = (r: ModelHits): (number[] | undefined)[] => r.embeddings;
export const perLayerCounts = (r: ModelHits): Record<number, number> => r.perLayer;

/**
 * One number for the whole first run, weighted by what the pieces actually
 * weigh over the wire: the index is 19.1 MB of it, the encoder and its runtime
 * 21 MB. Used to draw the model as it arrives, so the wait is the thing being
 * waited for.
 */
const INDEX_SHARE = 0.48;
export function progressFraction(s: LoadState): number {
  if (s.phase === "ready") return 1;
  const within = s.total > 0 ? Math.min(1, s.loaded / s.total) : 0;
  return s.phase === "index" ? within * INDEX_SHARE : INDEX_SHARE + within * (1 - INDEX_SHARE);
}
