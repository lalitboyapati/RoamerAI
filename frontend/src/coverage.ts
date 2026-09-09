import type { ManifestModel } from "./types";

/** quintic smootherstep — the default easing (VISUAL-DIRECTION §4) */
export const smooth = (t: number) => t * t * t * (t * (6 * t - 15) + 10);

/**
 * Density that counts as "saturated" — hits per 1,000 indexed descriptions.
 *
 * The deep preset caps its vector candidate pool at k=600, so `found` tops out
 * there: against Gemma's 26,603 indexed descriptions that is a density of 22.6,
 * against Llama's 32,565 it is 18.4. At the old value of 6 almost every real
 * query saturated — "sepsis", "unit tests" and "climate model" all returned a
 * flat 100 — and a verdict that reads "well represented" for everything tells
 * nobody anything. 16 puts saturation just under the ceiling both models can
 * reach, and leaves the thin concepts ("protein folding" at 35 hits, "kubernetes"
 * at 33) down in the weak band where they belong.
 *
 * Still a heuristic with no evaluation behind it, and the UI says so.
 */
export const D0 = 16.0;

/**
 * Coverage 0-100 (docs/01-architecture.md §6): how many features fire for the
 * concept, normalised by model size, weighted by how many layers it spans.
 */
export function coverageScore(
  found: number,
  layersHit: number,
  model: ManifestModel
): number {
  const indexed = model.deep.total;
  if (!indexed || !found) return 0;
  const density = found / (indexed / 1000);
  const spread = layersHit / model.n_layers;
  const saturation = Math.min(1, Math.sqrt(density / D0));
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
