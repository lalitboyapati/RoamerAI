# 03 — Typesense: exactly what we use and why

Typesense docs: https://typesense.org/docs/latest/api/ (server 30.x). Everything below is implemented in `scripts/index_typesense.py`; this doc explains it.

## 1. Feature-by-feature

| # | Typesense feature | How RoamerAI uses it | Judge-facing line |
|---|---|---|---|
| 1 | **Collections with typed fields + facets** | `features_fast`, `features_deep`; `model` and `layer` are facets | — |
| 2 | **Bulk import API** (`/documents/import`, JSONL, `action=upsert`) | 1.47M docs in 10k-line chunks; idempotent re-runs | "1.5M documents indexed in minutes" |
| 3 | **Typo-tolerant keyword search** (`num_typos`, `prefix`, `drop_tokens_threshold`) | Fast mode. `drop_tokens_threshold: 0` → all query words must match (precision over recall for an exact mode) | "Fast mode is exhaustive and exact" |
| 4 | **Auto-embedding with a built-in model** (`embed.from`, `ts/all-MiniLM-L12-v2`) | `features_deep.embedding` generated server-side at import; queries embedded server-side at search | "No embedding pipeline, no GPU, no OpenAI bill" |
| 5 | **Hybrid search** (`query_by: "...,embedding"`, `vector_query: "embedding:([], alpha, k, distance_threshold)"`) | Deep mode: keyword + semantic rank-fused; `alpha 0.6` leans semantic; `distance_threshold 0.60` cuts weak matches so `found` is meaningful | "Type the idea, not the keyword" |
| 6 | **Federated `multi_search`** | One HTTP request returns Gemma and Llama results side by side for Compare | "Two models, one round trip" |
| 7 | **Faceting** (`facet_by: layer`, `max_facet_values: 64`) | Per-layer hit counts over the *whole* result set without paging → per-layer bar + spread term of the score | "The layer bar is a facet" |
| 8 | **`found`** | Total matches → density term of the score, no paging | — |
| 9 | **Filtering** (`filter_by: model:=gemma-2-2b`) | Selects the model inside a shared collection; also enables layer-range filters later (`layer:[10..20]`) | — |
| 10 | **Presets** (`/presets/{name}`) | All search params stored server-side as `roamer_fast` / `roamer_deep`; browser sends only `{preset, q, filter_by}` | "Relevance tuned live without redeploying" |
| 11 | **Synonyms** (`/collections/{c}/synonyms/{id}`, multi-way) | Domain abbreviations: `mri` ↔ `magnetic resonance imaging`, `scotus` ↔ `supreme court`, `ml` ↔ `machine learning`… | "Speaks the field's shorthand" |
| 12 | **Highlighting** (`highlight_fields: description`) | `<mark>` snippets in the hit list / node labels | — |
| 13 | **Scoped search-only API key** (`actions: documents:search`, `collections: features_.*`) | Browser calls Typesense directly; no server | "Typesense is the backend" |
| 14 | `exclude_fields` | Don't ship 384 floats × 250 hits to the browser | — |

Not used (say so if asked): Conversational/RAG, Natural Language Search, geo, JOINs, image/voice. They don't serve the problem; we picked the niche path (hybrid semantic + facets as an analytics primitive).

## 2. Schemas (from `index_typesense.py`)

```jsonc
// features_fast
{ "name": "features_fast", "fields": [
  { "name": "model",        "type": "string",   "facet": true },
  { "name": "layer",        "type": "int32",    "facet": true },
  { "name": "index",        "type": "int32" },
  { "name": "description",  "type": "string" },
  { "name": "descriptions", "type": "string[]", "optional": true },
  { "name": "explainer",    "type": "string",   "facet": true, "optional": true },
  { "name": "source",       "type": "string",   "index": false, "optional": true },
  { "name": "np_url",       "type": "string",   "index": false, "optional": true }
]}
// features_deep = same fields +
  { "name": "embedding", "type": "float[]",
    "embed": { "from": ["description"], "model_config": { "model_name": "ts/all-MiniLM-L12-v2" } } }
```

## 3. Presets (the relevance knobs — tune here, re-run `setup`)

```jsonc
// roamer_fast
{ "query_by": "description,descriptions", "query_by_weights": "3,1",
  "num_typos": 1, "typo_tokens_threshold": 1, "prefix": false, "drop_tokens_threshold": 0,
  "facet_by": "layer", "max_facet_values": 64, "per_page": 250,
  "exclude_fields": "descriptions", "highlight_fields": "description" }

// roamer_deep
{ "query_by": "description,descriptions,embedding", "query_by_weights": "3,1,1",
  "num_typos": 1, "prefix": false, "drop_tokens_threshold": 0,
  "vector_query": "embedding:([], alpha: 0.6, k: 600, distance_threshold: 0.70)",
  "facet_by": "layer", "max_facet_values": 64, "per_page": 250,
  "exclude_fields": "embedding,descriptions", "highlight_fields": "description" }
```

Knob guide:
- Fast too strict (0 results for 3-word queries)? Set `drop_tokens_threshold: 1` (drops words until ≥1 result) — but then `found` inflates; prefer telling users to use fewer words, or switch to Deep.
- Fast too noisy? `num_typos: 0`.
- Deep returning junk? Lower `distance_threshold` to `0.50` (stricter). Deep returning too little? Raise to `0.70`, raise `k` to `1000`.
- Deep ignoring keywords? Lower `alpha` toward `0.4`.
- `per_page` max is 250; we never page. Scene lights ≤250 nodes, score uses `found`.

## 4. Query examples

Fast, one model:
```bash
curl "$TS/multi_search" -H "X-TYPESENSE-API-KEY: $SEARCH_KEY" -d '{"searches":[
  {"collection":"features_fast","preset":"roamer_fast","q":"protein folding","filter_by":"model:=gemma-2-2b"}]}'
```
Deep, compare (two searches, one request):
```bash
curl "$TS/multi_search" -H "X-TYPESENSE-API-KEY: $SEARCH_KEY" -d '{"searches":[
  {"collection":"features_deep","preset":"roamer_deep","q":"how cells repair damaged DNA","filter_by":"model:=gemma-2-2b"},
  {"collection":"features_deep","preset":"roamer_deep","q":"how cells repair damaged DNA","filter_by":"model:=llama3.1-8b"}]}'
```
Restrict to late layers (possible follow-up feature): `"filter_by":"model:=gemma-2-2b && layer:>=13"`.

Reading the response — the three things the UI needs:
```js
const r = res.results[i];
r.found                                             // → density
r.facet_counts[0].counts  // [{value:"12",count:31},...] → per-layer bar + spread
r.hits.map(h => ({ ...h.document, rel: h.hybrid_search_info?.rank_fusion_score ?? null, vd: h.vector_distance ?? null }))
```
Glow intensity: Deep → `1 - vector_distance` (or `rank_fusion_score`); Fast → `1 - rank/hits.length` (text_match is a big integer, use rank order).

## 5. Frontend client (typesense npm package)

```ts
import Typesense from "typesense";
export const ts = new Typesense.Client({
  nodes: [{ host: import.meta.env.VITE_TYPESENSE_HOST, port: Number(import.meta.env.VITE_TYPESENSE_PORT), protocol: import.meta.env.VITE_TYPESENSE_PROTOCOL }],
  apiKey: import.meta.env.VITE_TYPESENSE_SEARCH_KEY,   // search-only
  connectionTimeoutSeconds: 10,
});

export async function searchModels(q: string, mode: "fast" | "deep", models: ModelId[]) {
  const collection = mode === "fast" ? "features_fast" : "features_deep";
  const preset = mode === "fast" ? "roamer_fast" : "roamer_deep";
  const res = await ts.multiSearch.perform({
    searches: models.map(m => ({ collection, preset, q, filter_by: `model:=${m}` })),
  });
  return res.results;   // same order as `models`
}
```
CORS: Typesense Cloud allows browser calls by default; local Docker needs `--enable-cors` (already in the command in 02 §5).

## 6. Setup output you must capture

`index_typesense.py setup` prints the **search-only key once**. Put it in `frontend/.env` as `VITE_TYPESENSE_SEARCH_KEY`. If lost: `curl -X DELETE $TS/keys/{id}` with the admin key and re-run `setup` (it creates a new one).
