import { create } from "zustand";
import { coverageScore } from "./coverage";
import { otherModel, perLayerCounts, searchCounterpart, searchModels, toEmbeddings, toFeatures } from "./search";
import { layoutFeatures } from "./geometry";
import { MODEL_IDS, type Counterpart, type DragMode, type Feature, type Manifest, type ModelId, type ModelResult, type Mode, type Shape, type View } from "./types";

interface State {
  q: string;
  mode: Mode;
  view: View;
  manifest: Manifest | null;
  results: Partial<Record<ModelId, ModelResult>>;
  loading: boolean;
  error: string | null;
  /** feature id under the cursor, or null */
  hovered: string | null;
  /** layer isolated by clicking a ring, a tick or a bar, or null */
  isolated: number | null;
  /** layer under the cursor anywhere (tick column, bar, or 3D ring) */
  hoveredLayer: number | null;
  /** bumped on every completed search so the scene can re-run its ignition */
  generation: number;
  /** bumped to ease the camera back to the framing shot */
  frameNonce: number;
  /** one feature and its nearest analogues in the other model */
  counterpart: Counterpart | null;
  counterpartLoading: boolean;
  /** diagram-only: every panel hidden except the search field and the legend */
  focus: boolean;
  shape: Shape;
  /** the Neuronpedia link list, kept out of the main ui until asked for */
  sourcesOpen: boolean;
  /** what a plain left-drag does in the scene */
  drag: DragMode;

  loadManifest: () => Promise<void>;
  setQuery: (q: string) => void;
  /** pick a concept and the mode that can actually find it, in one go */
  askFor: (q: string, mode: Mode) => void;
  setMode: (mode: Mode) => void;
  setView: (view: View) => void;
  setHovered: (id: string | null) => void;
  setHoveredLayer: (layer: number | null) => void;
  toggleIsolated: (layer: number | null) => void;
  resetCamera: () => void;
  run: () => Promise<void>;
  findCounterpart: (id: string) => Promise<void>;
  clearCounterpart: () => void;
  toggleFocus: () => void;
  setShape: (shape: Shape) => void;
  toggleSources: () => void;
  setDrag: (drag: DragMode) => void;
}

/** Which models the current view needs results for. */
export const modelsFor = (view: View): ModelId[] =>
  view === "compare" ? MODEL_IDS : [view];

let debounce: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

export const useStore = create<State>((set, get) => ({
  q: "",
  mode: "fast",
  view: "gemma-2-2b",
  manifest: null,
  results: {},
  loading: false,
  error: null,
  hovered: null,
  isolated: null,
  hoveredLayer: null,
  generation: 0,
  frameNonce: 0,
  counterpart: null,
  counterpartLoading: false,
  focus: false,
  shape: "stack",
  sourcesOpen: false,
  drag: "orbit",

  loadManifest: async () => {
    try {
      const res = await fetch("/manifest.json");
      if (!res.ok) throw new Error(`manifest.json ${res.status}`);
      set({ manifest: (await res.json()) as Manifest });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  setQuery: (q) => {
    set({ q, isolated: null, counterpart: null });
    clearTimeout(debounce);
    if (!q.trim()) {
      set({ results: {}, loading: false, error: null });
      return;
    }
    debounce = setTimeout(() => void get().run(), 250);
  },

  askFor: (q, mode) => {
    clearTimeout(debounce);
    set({ q, mode, isolated: null, counterpart: null });
    void get().run();
  },

  setMode: (mode) => {
    set({ mode });
    if (get().q.trim()) void get().run();
  },

  setView: (view) => {
    set({ view, isolated: null });
    if (get().q.trim()) void get().run();
  },

  setHovered: (hovered) => set({ hovered }),

  setHoveredLayer: (hoveredLayer) => set({ hoveredLayer }),

  toggleIsolated: (layer) =>
    set((s) => ({ isolated: layer === null || s.isolated === layer ? null : layer })),

  resetCamera: () => set((s) => ({ isolated: null, frameNonce: s.frameNonce + 1 })),

  run: async () => {
    const { q, mode, view, manifest } = get();
    const query = q.trim();
    if (!query || !manifest) return;
    const models = modelsFor(view);
    const mine = ++seq;
    set({ loading: true, error: null });
    const t0 = performance.now();
    try {
      const raw = await searchModels(query, mode, models);
      if (mine !== seq) return; // a newer search already landed
      const elapsed = Math.round(performance.now() - t0);
      const results: Partial<Record<ModelId, ModelResult>> = {};
      raw.forEach((r, i) => {
        const model = models[i];
        if (r.error) throw new Error(r.error);
        const perLayer = perLayerCounts(r);
        const layersHit = Object.values(perLayer).filter((n) => n > 0).length;
        const laid = layoutFeatures(toFeatures(r, mode), toEmbeddings(r));
        results[model] = {
          found: r.found,
          perLayer,
          layersHit,
          features: laid.features,
          clusters: laid.clusters,
          score: coverageScore(r.found, layersHit, manifest.models[model], mode),
          ms: r.search_time_ms ?? elapsed,
        };
      });
      set((s) => ({ results, loading: false, generation: s.generation + 1 }));
    } catch (e) {
      if (mine !== seq) return;
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  findCounterpart: async (id) => {
    const { results, view } = get();
    let source: Feature | undefined;
    for (const m of modelsFor(view)) {
      source = results[m]?.features.find((f) => f.id === id);
      if (source) break;
    }
    if (!source) return;
    const target = otherModel(source.model);
    // both stacks have to be on screen for the counterpart to mean anything
    if (view !== "compare") set({ view: "compare" });
    set({ counterpartLoading: true, isolated: null });
    try {
      const r = await searchCounterpart(source, target);
      if (r.error) throw new Error(r.error);
      set({ counterpart: { source, target, features: toFeatures(r, "deep") }, counterpartLoading: false });
      if (view !== "compare") void get().run();
    } catch (e) {
      set({ counterpartLoading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  clearCounterpart: () => set({ counterpart: null }),

  toggleFocus: () => set((s) => ({ focus: !s.focus })),

  setShape: (shape) => set((s) => ({ shape, frameNonce: s.frameNonce + 1 })),

  toggleSources: () => set((s) => ({ sourcesOpen: !s.sourcesOpen })),

  setDrag: (drag) => set({ drag }),
}));
