import { DISC_RADIUS, INNER_RADIUS, LAYER_GAP, nodePosition } from "./coverage";
import type { Cluster, Feature, Shape } from "./types";

/**
 * Semantic layout for deep-mode hits.
 *
 * Every deep document carries the 384-d MiniLM embedding of its description.
 * We PCA those to 2-D in the browser and place each lit feature on its layer
 * disc by that projection: angle = direction of meaning, distance from the
 * centre = how far from the average matched concept. The same PCA basis is
 * used for every layer of a model, so "left of the disc" means the same thing
 * on layer 3 and layer 20. K-means over the same vectors gives the colours,
 * and the most distinctive words in each cluster give the legend its names.
 *
 * Honest caveat, kept in the UI copy: this is the geometry of the descriptions'
 * meanings, not of the model's own representation space.
 */

export const CLUSTER_COLOURS = ["#58C4DD", "#83C167", "#F0AC5F", "#FC6255", "#5CD0B3", "#C678DD"];

const STOP = new Set(
  (
    "the and to of in or with for that on a an as by from at is are be this these those it its " +
    "related terms term references reference phrases phrase words word mentions mention specific " +
    "various concepts concept instances instance contexts context particularly associated indicating " +
    "text content including especially often about within used use such various other into their " +
    "there which when where also may can not than more like well general typically commonly across " +
    "different some any all types type kind kinds names name forms form parts part related-to"
  ).split(/\s+/)
);

function normalise(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

/** Top-2 principal components by power iteration with Gram-Schmidt deflation. */
function pca2(X: number[][]): [number, number][] {
  const n = X.length;
  const d = X[0].length;
  const mean = new Array<number>(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j] / n;
  const C = X.map((row) => row.map((x, j) => x - mean[j]));

  const comps: number[][] = [];
  for (let c = 0; c < 2; c++) {
    let v = new Array<number>(d).fill(0).map((_, j) => Math.sin(j * 12.9898 + c * 78.233) * 43758.5453 % 1);
    for (let it = 0; it < 40; it++) {
      // v <- C^T (C v)
      const proj = C.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
      const next = new Array<number>(d).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) next[j] += C[i][j] * proj[i];
      for (const prev of comps) {
        const dot = next.reduce((s, x, j) => s + x * prev[j], 0);
        for (let j = 0; j < d; j++) next[j] -= dot * prev[j];
      }
      v = normalise(next);
    }
    comps.push(v);
  }
  return C.map((row) => [
    row.reduce((s, x, j) => s + x * comps[0][j], 0),
    row.reduce((s, x, j) => s + x * comps[1][j], 0),
  ]);
}

/** Deterministic k-means: farthest-point seeding, fixed iteration count. */
function kmeans(X: number[][], k: number): number[] {
  const n = X.length;
  const dist2 = (a: number[], b: number[]) => {
    let s = 0;
    for (let j = 0; j < a.length; j++) s += (a[j] - b[j]) ** 2;
    return s;
  };
  const centroids: number[][] = [X[0].slice()];
  while (centroids.length < k) {
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < n; i++) {
      const dmin = Math.min(...centroids.map((c) => dist2(X[i], c)));
      if (dmin > bestD) {
        bestD = dmin;
        best = i;
      }
    }
    centroids.push(X[best].slice());
  }
  let assign = new Array<number>(n).fill(0);
  for (let it = 0; it < 12; it++) {
    assign = X.map((x) => {
      let bi = 0;
      let bd = Infinity;
      centroids.forEach((c, ci) => {
        const dd = dist2(x, c);
        if (dd < bd) {
          bd = dd;
          bi = ci;
        }
      });
      return bi;
    });
    centroids.forEach((c, ci) => {
      const members = X.filter((_, i) => assign[i] === ci);
      if (!members.length) return;
      for (let j = 0; j < c.length; j++) c[j] = members.reduce((s, m) => s + m[j], 0) / members.length;
    });
  }
  return assign;
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Two words that are frequent in this cluster and rare in the others. */
function labelFor(descs: string[], others: string[]): string {
  const tf = new Map<string, number>();
  for (const d of descs) for (const w of new Set(tokens(d))) tf.set(w, (tf.get(w) ?? 0) + 1);
  const df = new Map<string, number>();
  for (const d of others) for (const w of new Set(tokens(d))) df.set(w, (df.get(w) ?? 0) + 1);
  const scored = [...tf.entries()].map(([w, c]) => [w, (c / descs.length) / (1 + (df.get(w) ?? 0) / Math.max(1, others.length))] as const);
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, 2).map(([w]) => w).join(" · ") || "misc";
}

export interface Layout {
  features: Feature[];
  clusters: Cluster[];
}

/**
 * Attach a semantic position and a cluster to each feature. Features without
 * an embedding (fast mode) keep their hashed position and no cluster.
 */
export function layoutFeatures(features: Feature[], embeddings: (number[] | undefined)[]): Layout {
  const idx = embeddings.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 3) return { features, clusters: [] };

  const X = idx.map((i) => normalise(embeddings[i] as number[]));
  const pc = pca2(X);
  const maxR = Math.max(...pc.map(([x, y]) => Math.hypot(x, y))) || 1;

  const k = Math.max(2, Math.min(CLUSTER_COLOURS.length, Math.round(Math.sqrt(idx.length / 3))));
  const assign = kmeans(X, k);

  const out = features.slice();
  idx.forEach((fi, j) => {
    const [x, y] = pc[j];
    const angle = Math.atan2(y, x);
    const r = Math.min(1, Math.hypot(x, y) / maxR);
    const radius = INNER_RADIUS + (DISC_RADIUS - INNER_RADIUS) * (0.1 + 0.9 * r);
    out[fi] = {
      ...features[fi],
      pos: [Math.cos(angle) * radius, Math.sin(angle) * radius],
      cluster: assign[j],
    };
  });

  const clusters: Cluster[] = [];
  for (let c = 0; c < k; c++) {
    const mine = idx.filter((_, j) => assign[j] === c).map((fi) => features[fi].description);
    const rest = idx.filter((_, j) => assign[j] !== c).map((fi) => features[fi].description);
    if (!mine.length) continue;
    clusters.push({ id: c, label: labelFor(mine, rest), colour: CLUSTER_COLOURS[c], size: mine.length });
  }
  clusters.sort((a, b) => b.size - a.size);
  return { features: out, clusters };
}

export const GLOBE_RADIUS = 5.6;

/** Latitude of a layer on the globe: layer 0 near the south pole, last layer near the north. */
export function globeLatitude(layer: number, nLayers: number): number {
  return -Math.PI / 2 + Math.PI * ((layer + 0.5) / nLayers);
}

/**
 * A point on (or just above) the globe. `angle` is longitude, `lift` pushes the
 * point off the surface in world units.
 */
export function globePoint(layer: number, nLayers: number, angle: number, lift: number, xOffset: number): [number, number, number] {
  const lat = globeLatitude(layer, nLayers);
  const R = GLOBE_RADIUS + lift;
  return [Math.cos(lat) * Math.cos(angle) * R + xOffset, Math.sin(lat) * R, Math.cos(lat) * Math.sin(angle) * R];
}

/**
 * World position of a feature. Stack: semantic (x,z) on the layer disc if it has
 * one, hashed otherwise. Globe: same angle becomes longitude, and the semantic
 * distance from the disc centre becomes a lift off the surface, so outliers float.
 */
export function featurePosition(f: Feature, xOffset: number, shape: Shape = "stack", nLayers = 26): [number, number, number] {
  if (shape === "stack") {
    if (f.pos) return [f.pos[0] + xOffset, f.layer * LAYER_GAP, f.pos[1]];
    return nodePosition(f.model, f.layer, f.index, xOffset);
  }
  const [x, , z] = f.pos ? [f.pos[0], 0, f.pos[1]] : nodePosition(f.model, f.layer, f.index, 0);
  const angle = Math.atan2(z, x);
  const lift = f.pos ? 0.9 * (Math.hypot(x, z) - INNER_RADIUS) / (DISC_RADIUS - INNER_RADIUS) : 0.05;
  return globePoint(f.layer, nLayers, angle, Math.max(0, lift), xOffset);
}
