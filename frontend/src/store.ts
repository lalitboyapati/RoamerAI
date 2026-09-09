import { create } from "zustand";
import { coverageScore } from "./coverage";
import {
  getCatalog,
  onLoad,
  searchCounterpart,
  searchModels,
  startSearch,
  toEmbeddings,
  toFeatures,
} from "./search";
import { layoutFeatures } from "./geometry";
import type {
  Catalog,
  Counterpart,
  DragMode,
  Feature,
  LoadState,
  ModelId,
  ModelResult,
  Shape,
} from "./types";

/** The walkthrough's steps, in order; the name is also what each one points at. */
export const GUIDE_ANCHORS = ["map", "score", "bands", "layers"] as const;
export const GUIDE_STEPS = GUIDE_ANCHORS.length;
const GUIDE_KEY = "romirai.guide.seen";
const PICK_KEY = "romirai.models";

/** localStorage is unavailable in some privacy modes; a preference is not worth throwing over. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/**
 * Errors reach a stranger at a URL with nobody to interpret them, so they name
 * the problem and what to do rather than repeating a status line. Everything
 * the search needs is a static file on this origin, so a failure here is a
 * broken download or a browser that cannot run the encoder.
 */
function explain(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const low = raw.toLowerCase();
  if (low.includes("catalog.json")) {
    return "the model catalog did not load, so there is nothing to search. reload the page.";
  }
  if (low.includes("/idx/")) {
    return "the search index did not finish downloading. reload the page — the first visit pulls it once and every visit after is cached.";
  }
  if (low.includes("wasm") || low.includes("onnx") || low.includes("backend")) {
    return "this browser could not start the sentence encoder, which needs webassembly. try a current desktop browser, and check that no extension is blocking wasm.";
  }
  if (low.includes("still loading")) {
    return "the index is still loading. the first visit downloads it once; after that it is cached.";
  }
  return `the search could not run: ${raw}`;
}

interface State {
  q: string;
  catalog: Catalog | null;
  /** the models being compared — one, two or three */
  selected: ModelId[];
  results: Partial<Record<ModelId, ModelResult>>;
  loading: boolean;
  error: string | null;
  hovered: string | null;
  isolated: number | null;
  hoveredLayer: number | null;
  generation: number;
  frameNonce: number;
  counterpart: Counterpart | null;
  counterpartLoading: boolean;
  focus: boolean;
  shape: Shape;
  sourcesOpen: boolean;
  drag: DragMode;
  guideStep: number | null;
  guideSeen: boolean;
  load: LoadState;

  loadCatalog: () => Promise<void>;
  setSelected: (models: ModelId[]) => void;
  begin: (models: ModelId[]) => void;
  setQuery: (q: string) => void;
  askFor: (q: string) => void;
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
  nextGuide: () => void;
  endGuide: () => void;
  replayGuide: () => void;
}

let watchingLoad = false;
let debounce: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

const savedPick = (() => {
  try {
    const v = JSON.parse(read(PICK_KEY) ?? "null");
    return Array.isArray(v) && v.length ? (v as ModelId[]) : [];
  } catch {
    return [];
  }
})();

export const useStore = create<State>((set, get) => ({
  q: "",
  catalog: null,
  selected: savedPick,
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
  guideStep: null,
  guideSeen: read(GUIDE_KEY) === "1",
  load: { phase: "index", loaded: 0, total: 0 },

  loadCatalog: async () => {
    try {
      set({ catalog: await getCatalog() });
    } catch (e) {
      set({ error: explain(e) });
    }
  },

  setSelected: (models) => {
    write(PICK_KEY, JSON.stringify(models));
    set({ selected: models, isolated: null, counterpart: null });
    if (get().q.trim()) void get().run();
  },

  /** Commit to a set of models and start pulling exactly those. */
  begin: (models) => {
    write(PICK_KEY, JSON.stringify(models));
    if (!watchingLoad) {
      watchingLoad = true;
      onLoad((load) => set({ load }));
    }
    set({ selected: models });
    void startSearch(models).catch((e) => set({ error: explain(e) }));
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

  askFor: (q) => {
    clearTimeout(debounce);
    set({ q, isolated: null, counterpart: null });
    void get().run();
  },

  setHovered: (hovered) => set({ hovered }),
  setHoveredLayer: (hoveredLayer) => set({ hoveredLayer }),

  // the layer panel and the counterpart share a slot on screen, so opening one closes the other
  toggleIsolated: (layer) =>
    set((s) => {
      const isolated = layer === null || s.isolated === layer ? null : layer;
      // The last note asks them to open a layer. Doing it finishes the
      // walkthrough rather than leaving it asking for something already done.
      const done = isolated !== null && s.guideStep === GUIDE_STEPS - 1;
      if (done) write(GUIDE_KEY, "1");
      return {
        isolated,
        counterpart: null,
        ...(done ? { guideStep: null, guideSeen: true } : null),
      };
    }),

  resetCamera: () => set((s) => ({ isolated: null, frameNonce: s.frameNonce + 1 })),

  run: async () => {
    const { q, selected, catalog } = get();
    const query = q.trim();
    if (!query || !catalog || !selected.length) return;
    const mine = ++seq;
    set({ loading: true, error: null });
    try {
      const { results: raw, ms } = await searchModels(query, selected);
      if (mine !== seq) return; // a newer search already landed
      const results: Partial<Record<ModelId, ModelResult>> = {};
      for (const model of selected) {
        const r = raw[model];
        if (!r) continue;
        const spec = catalog.models[model];
        const layersHit = Object.values(r.perLayer).filter((n) => n > 0).length;
        const laid = layoutFeatures(toFeatures(r, model, spec.sourceSet), toEmbeddings(r));
        results[model] = {
          ...r,
          layersHit,
          features: laid.features,
          clusters: laid.clusters,
          score: coverageScore(r.density, layersHit, spec.nLayers),
          ms,
        };
      }
      // The walkthrough annotates a resolved result, so it waits for one that
      // actually lit something up — a dark map explains itself in the rail instead.
      const lit = Object.values(results).some((r) => r!.features.length > 0);
      set((s) => ({
        results,
        loading: false,
        generation: s.generation + 1,
        guideStep: lit && !s.guideSeen && s.guideStep === null ? 0 : s.guideStep,
      }));
    } catch (e) {
      if (mine !== seq) return;
      set({ loading: false, error: explain(e) });
    }
  },

  findCounterpart: async (id) => {
    const { results, selected, catalog } = get();
    let source: Feature | undefined;
    for (const m of selected) {
      source = results[m]?.features.find((f) => f.id === id);
      if (source) break;
    }
    if (!source || !catalog) return;
    const targets = selected.filter((m) => m !== source!.model);
    if (!targets.length) return;
    set({ counterpartLoading: true, isolated: null });
    try {
      const raw = await searchCounterpart(source, targets);
      const features: Feature[] = [];
      for (const t of targets) {
        const r = raw[t];
        if (r) features.push(...toFeatures(r, t, catalog.models[t].sourceSet).slice(0, 20));
      }
      set({
        counterpart: { source, target: targets[0], features },
        counterpartLoading: false,
      });
    } catch (e) {
      set({ counterpartLoading: false, error: explain(e) });
    }
  },

  clearCounterpart: () => set({ counterpart: null }),
  toggleFocus: () => set((s) => ({ focus: !s.focus })),
  setShape: (shape) => set((s) => ({ shape, frameNonce: s.frameNonce + 1 })),
  toggleSources: () => set((s) => ({ sourcesOpen: !s.sourcesOpen })),
  setDrag: (drag) => set({ drag }),

  nextGuide: () =>
    set((s) => {
      const next = (s.guideStep ?? 0) + 1;
      if (next >= GUIDE_STEPS) {
        write(GUIDE_KEY, "1");
        return { guideStep: null, guideSeen: true };
      }
      return { guideStep: next };
    }),

  endGuide: () => {
    write(GUIDE_KEY, "1");
    set({ guideStep: null, guideSeen: true });
  },

  replayGuide: () => set({ guideStep: 0 }),
}));
