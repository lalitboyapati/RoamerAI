import Typesense from "typesense";
import type { Feature, ModelId, TsResult } from "./types";

export const otherModel = (m: ModelId): ModelId => (m === "gemma-2-2b" ? "llama3.1-8b" : "gemma-2-2b");

const env = import.meta.env;

export const client = new Typesense.Client({
  nodes: [
    {
      host: env.VITE_TYPESENSE_HOST ?? "localhost",
      port: Number(env.VITE_TYPESENSE_PORT ?? 8108),
      protocol: env.VITE_TYPESENSE_PROTOCOL ?? "http",
    },
  ],
  apiKey: env.VITE_TYPESENSE_SEARCH_KEY ?? "",
  connectionTimeoutSeconds: 15,
});

/**
 * One federated multi_search covers every model on screen. Search parameters
 * live server-side in the roamer_deep preset — the browser only ever sends
 * collection, preset, q and filter_by.
 *
 * Hybrid semantic search is the only mode there is: keyword-only matching made
 * every multi-word concept a dead end for anyone who did not already know the
 * index's vocabulary.
 */
export async function searchModels(q: string, models: ModelId[]): Promise<TsResult[]> {
  const res = await client.multiSearch.perform({
    searches: models.map((m) => ({
      collection: "features_deep",
      preset: "roamer_deep",
      q,
      filter_by: `model:=${m}`,
    })),
  });
  return res.results as unknown as TsResult[];
}

export function toFeatures(result: TsResult): Feature[] {
  const hits = result.hits ?? [];
  return hits.map((h) => {
    // Cosine similarity (1 - distance) spreads smoothly over the hit set. The
    // rank-fusion score decays as 1/rank, so all but the top few would barely glow.
    const rel =
      h.vector_distance !== undefined
        ? 1 - h.vector_distance
        : h.hybrid_search_info?.rank_fusion_score ?? 0.5;
    return {
      id: h.document.id,
      model: h.document.model,
      layer: h.document.layer,
      index: h.document.index,
      description: h.document.description,
      npUrl: h.document.np_url,
      rel: Math.max(0, Math.min(1, rel)),
    };
  });
}

/** Embedding per hit, in hit order. */
export function toEmbeddings(result: TsResult): (number[] | undefined)[] {
  return (result.hits ?? []).map((h) => h.document.embedding);
}

/**
 * Counterpart search: the nearest features in the *other* model to one feature,
 * found by searching that model's deep index with the feature's description.
 * Nothing crosses between models except meaning.
 */
export async function searchCounterpart(source: Feature, target: ModelId): Promise<TsResult> {
  const res = await client.multiSearch.perform({
    searches: [
      {
        collection: "features_deep",
        preset: "roamer_deep",
        q: source.description,
        filter_by: `model:=${target}`,
        per_page: 40,
      },
    ],
  });
  return (res.results as unknown as TsResult[])[0];
}

export function perLayerCounts(result: TsResult): Record<number, number> {
  const facet = result.facet_counts?.find((f) => f.field_name === "layer");
  const out: Record<number, number> = {};
  for (const c of facet?.counts ?? []) out[Number(c.value)] = c.count;
  return out;
}
