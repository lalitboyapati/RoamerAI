import { create } from "zustand";
import { coverageScore } from "./coverage";
import { otherModel, perLayerCounts, searchCounterpart, searchModels, toEmbeddings, toFeatures } from "./search";
import { layoutFeatures } from "./geometry";
import { MODEL_IDS, type Counterpart, type DragMode, type Feature, type Manifest, type ModelId, type ModelResult, type Shape, type View } from "./types";

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
 * the problem and what to do rather than repeating a status line.
 */
function explain(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const low = raw.toLowerCase();
  if (low.includes("manifest.json")) {
    return "the model manifest did not load, so there is nothing to draw. reload the page; if it keeps failing the build is missing public/manifest.json.";
  }
  if (low.includes("401") || low.includes("403") || low.includes("api key") || low.includes("unauthor")) {
    return "the search index refused the key this page is holding. it needs a search-only Typesense key in VITE_TYPESENSE_SEARCH_KEY.";
  }
  if (low.includes("fetch") || low.includes("network") || low.includes("timeout") || low.includes("econn") || low.includes("failed to connect")) {
    return "cannot reach the search index. this page queries Typesense straight from the browser — there is no server in between — so the index is either down or not reachable from here.";
  }
  return `the search index returned an error: ${raw}`;
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

  loadManifest: async () => {
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
    const t0 = performance.now();
    try {
      const raw = await searchModels(query, models);
      if (mine !== seq) return; // a newer search already landed
      const elapsed = Math.round(performance.now() - t0);
      const results: Partial<Record<ModelId, ModelResult>> = {};
      raw.forEach((r, i) => {
        const model = models[i];
        if (r.error) throw new Error(r.error);
        const perLayer = perLayerCounts(r);
        const layersHit = Object.values(perLayer).filter((n) => n > 0).length;
        const laid = layoutFeatures(toFeatures(r), toEmbeddings(r));
        results[model] = {
          found: r.found,
          perLayer,
          layersHit,
          features: laid.features,
          clusters: laid.clusters,
          score: coverageScore(r.found, layersHit, manifest.models[model]),
          ms: r.search_time_ms ?? elapsed,
        };
      });
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
      if (r.error) throw new Error(r.error);
      set({ counterpart: { source, target, features: toFeatures(r) }, counterpartLoading: false });
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
