import type { ManifestModel, Mode } from "./types";

/** quintic smootherstep — the default easing (VISUAL-DIRECTION §4) */
export const smooth = (t: number) => t * t * t * (t * (6 * t - 15) + 10);

/**
 * Density that counts as "saturated", per mode. Tuned so that a solidly
 * represented concept ("protein folding" on Gemma) lands in the 60-80 band
 * in both modes despite deep being a ~1k/layer sample.
 */
export const D0: Record<Mode, number> = { fast: 4.0, deep: 6.0 };

/**
 * Coverage 0-100 (docs/01-architecture.md §6): how many features fire for the
 * concept, normalised by model size, weighted by how many layers it spans.
 */
export function coverageScore(
  found: number,
  layersHit: number,
  model: ManifestModel,
  mode: Mode
): number {
  const indexed = model[mode].total;
  if (!indexed || !found) return 0;
  const density = found / (indexed / 1000);
  const spread = layersHit / model.n_layers;
  const saturation = Math.min(1, Math.sqrt(density / D0[mode]));
  return Math.round(100 * saturation * (0.5 + 0.5 * spread));
}

/** FNV-1a over the feature's identity — same feature, same spot, every reload. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32, seeded from that hash */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const LAYER_GAP = 1.35;
export const DISC_RADIUS = 3.6;
/** Features sit in an annulus so the centre column stays clear for the block diagram. */
export const INNER_RADIUS = 2.05;

/**
 * Deterministic position for a feature: y from the layer, (x,z) from a hash of
 * (model, layer, index) spread uniformly over the layer's annulus.
 */
export function nodePosition(
  model: string,
  layer: number,
  index: number,
  xOffset = 0
): [number, number, number] {
  const r = rng(hash32(`${model}:${layer}:${index}`));
  const angle = r() * Math.PI * 2;
  const inner2 = INNER_RADIUS * INNER_RADIUS;
  const radius = Math.sqrt(inner2 + r() * (DISC_RADIUS * DISC_RADIUS - inner2));
  return [
    Math.cos(angle) * radius + xOffset,
    layer * LAYER_GAP,
    Math.sin(angle) * radius,
  ];
}
