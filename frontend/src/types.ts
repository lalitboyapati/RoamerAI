export type ModelId = "gemma-2-2b" | "llama3.1-8b";
export type View = ModelId | "compare";
/** how a model is drawn: stacked layer discs, or a globe with layers as latitudes */
export type Shape = "stack" | "globe";
/** what a plain left-drag does: turn the model, or move it across the screen */
export type DragMode = "orbit" | "pan";

export const MODEL_IDS: ModelId[] = ["gemma-2-2b", "llama3.1-8b"];

/** frontend/public/manifest.json — written by scripts/pull_data.py */
export interface ManifestModel {
  display: string;
  source_set: string;
  n_layers: number;
  width: number;
  fast: { total: number; per_layer: Record<string, number> };
  deep: { total: number; per_layer: Record<string, number> };
}
export interface Manifest {
  models: Record<ModelId, ManifestModel>;
  generated_at: string;
}

/** The document shape indexed by scripts/index_typesense.py (docs/01-architecture.md §4). */
export interface FeatureDoc {
  id: string;
  model: ModelId;
  layer: number;
  index: number;
  description: string;
  explainer?: string;
  source?: string;
  np_url?: string;
  /** deep collection only: MiniLM embedding of `description` */
  embedding?: number[];
}

export interface TsHit {
  document: FeatureDoc;
  text_match?: number;
  vector_distance?: number;
  hybrid_search_info?: { rank_fusion_score: number };
  highlight?: { description?: { snippet?: string } };
}

export interface TsFacetCount {
  field_name: string;
  counts: { value: string; count: number }[];
}

export interface TsResult {
  found: number;
  search_time_ms?: number;
  hits?: TsHit[];
  facet_counts?: TsFacetCount[];
  error?: string;
  code?: number;
}

/** One hit, flattened with everything the scene needs. */
export interface Feature {
  id: string;
  model: ModelId;
  layer: number;
  index: number;
  description: string;
  npUrl?: string;
  /** 0..1 relevance, drives glow size + brightness */
  rel: number;
  /** semantic (x,z) on the layer disc from PCA of the description embedding */
  pos?: [number, number];
  /** the same projection before it was mapped onto the disc annulus, each axis in -1..1 */
  pca?: [number, number];
  /** k-means cluster over description embeddings */
  cluster?: number;
}

export interface Cluster {
  id: number;
  label: string;
  colour: string;
  size: number;
}

/** A feature in one model and its nearest analogues in the other. */
export interface Counterpart {
  source: Feature;
  target: ModelId;
  features: Feature[];
}

export interface ModelResult {
  found: number;
  perLayer: Record<number, number>;
  features: Feature[];
  score: number;
  layersHit: number;
  ms: number;
  clusters: Cluster[];
}

/* --------------------------------------------------------------- the index
   The corpus ships as static files and is searched in the browser; these are
   the shapes that cross the worker boundary. */

export interface IndexMeta {
  version: number;
  embedModel: string;
  dims: number;
  scale: number;
  count: number;
  models: Record<ModelId, { offset: number; count: number }>;
}

export interface Hit {
  layer: number;
  index: number;
  description: string;
  /** cosine similarity to the query, 0..1 */
  score: number;
}

export interface ModelHits {
  /** every feature above the floor, not a page of them */
  found: number;
  perLayer: Record<number, number>;
  hits: Hit[];
  embeddings: number[][];
}

export type WorkerIn =
  | { type: "init" }
  | { type: "search"; id: number; q: string; models: ModelId[] };

export type WorkerOut =
  | { type: "progress"; phase: "index" | "model"; loaded: number; total: number }
  | { type: "phase"; phase: "index" | "model"; restored?: boolean }
  | { type: "ready"; restored: boolean; persisted: boolean }
  | { type: "result"; id: number; results: Record<string, ModelHits>; ms: number }
  | { type: "error"; id?: number; message: string };

/** How far the one-time load of the index and the encoder has got. */
export interface LoadState {
  phase: "index" | "model" | "ready";
  loaded: number;
  total: number;
  /** came back from this browser's store rather than the network */
  restored?: boolean;
  /** the browser promised not to evict it */
  persisted?: boolean;
}
