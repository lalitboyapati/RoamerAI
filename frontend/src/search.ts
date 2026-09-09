import Typesense from "typesense";
import type { Feature, ModelId, Mode, TsResult } from "./types";

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
 * live server-side in the presets (roamer_fast / roamer_deep) — the browser
 * only ever sends collection, preset, q and filter_by.
 */
export async function searchModels(
  q: string,
  mode: Mode,
  models: ModelId[]
): Promise<TsResult[]> {
  const collection = mode === "fast" ? "features_fast" : "features_deep";
  const preset = mode === "fast" ? "roamer_fast" : "roamer_deep";
  const res = await client.multiSearch.perform({
    searches: models.map((m) => ({
      collection,
      preset,
      q,
      filter_by: `model:=${m}`,
    })),
  });
  return res.results as unknown as TsResult[];
}

/** Deep gives us a real distance; fast only gives us rank order. */
export function toFeatures(result: TsResult, mode: Mode): Feature[] {
  const hits = result.hits ?? [];
  return hits.map((h, i) => {
    const rel =
      mode === "deep"
        ? h.hybrid_search_info?.rank_fusion_score ??
          (h.vector_distance !== undefined ? 1 - h.vector_distance : 0.5)
        : 1 - i / Math.max(1, hits.length);
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

export function perLayerCounts(result: TsResult): Record<number, number> {
  const facet = result.facet_counts?.find((f) => f.field_name === "layer");
  const out: Record<number, number> = {};
  for (const c of facet?.counts ?? []) out[Number(c.value)] = c.count;
  return out;
}
