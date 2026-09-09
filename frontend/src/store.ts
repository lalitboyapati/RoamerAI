import { create } from "zustand";
import { coverageScore } from "./coverage";
import { onLoad, otherModel, searchCounterpart, searchModels, startSearch, toEmbeddings, toFeatures } from "./search";
import { layoutFeatures } from "./geometry";
import { MODEL_IDS, type Counterpart, type DragMode, type Feature, type LoadState, type Manifest, type ModelId, type ModelResult, type Shape, type View } from "./types";

/** The walkthrough's steps, in order; the name is also what each one points at. */
export const GUIDE_ANCHORS = ["map", "score", "bands", "layers"] as const;
export const GUIDE_STEPS = GUIDE_ANCHORS.length;
const GUIDE_KEY = "romirai.guide.seen";

/** localStorage is unavailable in some privacy modes; a walkthrough is not worth throwing over. */
function readSeen(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeSeen() {
  try {
    localStorage.setItem(GUIDE_KEY, "1");
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
  if (low.includes("manifest.json")) {
    return "the model manifest did not load, so there is nothing to draw. reload the page.";
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
  /** which annotation of the first-search walkthrough is showing, or null */
  guideStep: number | null;
  /** the walkthrough runs once per browser, and never interrupts twice */
  guideSeen: boolean;
  /** how far the one-time download of the index and encoder has got */
  load: LoadState;

  loadManifest: () => Promise<void>;
  setQuery: (q: string) => void;
  /** run a concept straight away, skipping the keystroke debounce */
  askFor: (q: string) => void;
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
  nextGuide: () => void;
  endGuide: () => void;
  replayGuide: () => void;
}

/** Which models the current view needs results for. */
export const modelsFor = (view: View): ModelId[] =>
  view === "compare" ? MODEL_IDS : [view];

let debounce: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

export const useStore = create<State>((set, get) => ({
  q: "",
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
  guideStep: null,
  guideSeen: readSeen(),
  load: { phase: "index", loaded: 0, total: 0 },

  loadManifest: async () => {
    // the index is big and one-time; start pulling it before anyone types
    onLoad((load) => set({ load }));
    void startSearch().catch((e) => set({ error: explain(e) }));
    try {
      const res = await fetch("/manifest.json");
      if (!res.ok) throw new Error(`manifest.json ${res.status}`);
      set({ manifest: (await res.json()) as Manifest });
    } catch (e) {
      set({ error: explain(e) });
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

  askFor: (q) => {
    clearTimeout(debounce);
    set({ q, isolated: null, counterpart: null });
    void get().run();
  },

  setView: (view) => {
    // the counterpart is drawn on the other model's stack, which a single-model view hides
    set({ view, isolated: null, counterpart: null });
    if (get().q.trim()) void get().run();
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
      if (done) writeSeen();
      return {
        isolated,
        counterpart: null,
        ...(done ? { guideStep: null, guideSeen: true } : null),
      };
    }),

  resetCamera: () => set((s) => ({ isolated: null, frameNonce: s.frameNonce + 1 })),

  run: async () => {
    const { q, view, manifest } = get();
    const query = q.trim();
    if (!query || !manifest) return;
    const models = modelsFor(view);
    const mine = ++seq;
    set({ loading: true, error: null });
    try {
      const { results: raw, ms } = await searchModels(query, models);
      if (mine !== seq) return; // a newer search already landed
      const results: Partial<Record<ModelId, ModelResult>> = {};
      for (const model of models) {
        const r = raw[model];
        const perLayer = r.perLayer;
        const layersHit = Object.values(perLayer).filter((n) => n > 0).length;
        const laid = layoutFeatures(
          toFeatures(r, model, manifest.models[model].source_set),
          toEmbeddings(r)
        );
        results[model] = {
          found: r.found,
          perLayer,
          layersHit,
          features: laid.features,
          clusters: laid.clusters,
          score: coverageScore(r.found, layersHit, manifest.models[model]),
          ms,
        };
      }
      // The walkthrough annotates a resolved result, so it waits for one that
      // actually lit something up — a dark map explains itself in the rail instead.
      const lit = Object.values(results).some((r) => r.features.length > 0);
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
      const m = get().manifest;
      const features = m ? toFeatures(r, target, m.models[target].source_set).slice(0, 40) : [];
      set({ counterpart: { source, target, features }, counterpartLoading: false });
      if (view !== "compare") void get().run();
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
        writeSeen();
        return { guideStep: null, guideSeen: true };
      }
      return { guideStep: next };
    }),

  endGuide: () => {
    writeSeen();
    set({ guideStep: null, guideSeen: true });
  },

  replayGuide: () => set({ guideStep: 0 }),
}));
