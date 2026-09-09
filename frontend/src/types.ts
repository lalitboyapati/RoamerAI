/** A Neuronpedia model id. Open-ended: the catalog decides what exists. */
export type ModelId = string;

/** how a model is drawn: stacked layer discs, or a globe with layers as latitudes */
export type Shape = "stack" | "globe";
/** what a plain left-drag does: turn the model, or move it across the screen */
export type DragMode = "orbit" | "pan";

/* ------------------------------------------------------------------ catalog
   public/idx/catalog.json — written by scripts/build-index.mjs. One entry per
   model, each with its own directory of files, so a visitor downloads only the
   models they chose to compare. */

export interface CatalogModel {
  display: string;
  sourceSet: string;
  nLayers: number;
  /** features per layer in the full SAE, of which the index holds a sample */
  width: number;
  /** descriptions actually indexed */
  count: number;
  perLayer: Record<string, number>;
  /** int8 dequantisation scale for this model's vectors */
  scale: number;
  bytes: number;
}

export interface Catalog {
  version: number;
  embedModel: string;
  dims: number;
  models: Record<ModelId, CatalogModel>;
}

/* ------------------------------------------------------------------ results */

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

/** A feature in one model and its nearest analogues in another. */
export interface Counterpart {
  source: Feature;
  target: ModelId;
  features: Feature[];
}

export interface Hit {
  layer: number;
  index: number;
  description: string;
  /** cosine similarity to the query, 0..1 */
  score: number;
}

/**
 * What one model says about one concept.
 *
 * `found` is a raw count and is not comparable between models, because they
 * index different numbers of features; `density` is. Likewise `depth` is a
 * fraction of the network rather than a layer number, so a 26-layer model and
 * a 32-layer one can be read on the same axis.
 */
export interface ModelHits {
  found: number;
  /** hits per 1,000 indexed descriptions */
  density: number;
  /** mass-weighted mean position in the network, 0 = first layer, 1 = last */
  depth: number;
  /** entropy of the layer distribution over log(nLayers): 0 localised, 1 even */
  spread: number;
  perLayer: Record<number, number>;
  /** per-layer share of hits, indexed by relative depth — comparable across models */
  profile: { at: number; share: number }[];
  /** mean unit embedding of everything above the floor; compare across models */
  centroid: number[];
  hits: Hit[];
  embeddings: number[][];
}

export interface ModelResult extends ModelHits {
  layersHit: number;
  features: Feature[];
  clusters: Cluster[];
  score: number;
  ms: number;
}

export type WorkerIn =
  | { type: "init"; models: ModelId[] }
  | { type: "add"; models: ModelId[] }
  | { type: "search"; id: number; q: string; models: ModelId[] };

export type WorkerOut =
  | { type: "progress"; phase: "index" | "model"; loaded: number; total: number }
  | { type: "phase"; phase: "index" | "model"; restored?: boolean }
  | { type: "ready"; restored: boolean; persisted: boolean }
  | { type: "loaded"; models: ModelId[] }
  | { type: "result"; id: number; results: Record<ModelId, ModelHits>; ms: number }
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
