# BUILD PROMPT — RomirAI interactive frontend

You are building the entire frontend for **RomirAI** in one session. Read this whole document before writing code. Follow the build order exactly: each phase must run and be verified before you start the next. If you run out of time, a working Phase 3 beats a broken Phase 6.

---

## 1. Mission

RomirAI lets someone **see inside a language model by searching it**.

Interpretability research has decomposed Gemma 2 2B and Llama 3.1 8B into hundreds of thousands of *sparse-autoencoder features*, each with a plain-English description of what it fires on ("references to protein folding and tertiary structure"). ~1.5M of those descriptions are already indexed in Typesense.

The app has two ways in:

- **Search a concept** — type "protein folding"; every feature that encodes it lights up inside a 3D map of the model, with a coverage score and a per-layer distribution.
- **Run a sentence** — type "The protein misfolded into amyloid plaques."; the sentence is tokenized and run through the real model; click any token to see which features that specific token activated, drawn as beams into the 3D map.

Audience: researchers, students, and developers choosing a small domain-specific model. The question it answers: *does this model actually represent my field's concepts, and where?*

---

## 2. Hard constraints

- **No backend.** The browser calls Typesense Cloud directly with a search-only key, and Neuronpedia's public API directly. Do not create an API server, Next.js route handlers, or a proxy — except a Vite dev proxy if and only if CORS blocks Neuronpedia.
- **`VISUAL-DIRECTION.md` is binding.** Read it before writing a single component. Pure black void, Manim-derived palette, text floating with no containers, flat emissive materials, no lights. Where this document and that one differ on appearance, that one wins.
- **Stack:** Vite + React 18 + TypeScript (strict) + `@react-three/fiber` + `@react-three/drei` + `zustand` + `typesense`. Styling: Tailwind or plain CSS, your call — do not add a component library.
- **Runs on localhost** on a laptop with an integrated GPU. 55+ fps is a requirement, not a goal.
- **No `any`** on API response types. Define them once in `types.ts`.
- **Determinism:** a feature's 3D position is a pure function of `(model, layer, index)`. Same feature, same spot, every search, every reload.
- **Search parameters live in Typesense presets**, server-side. The browser sends only `{collection, preset, q, filter_by}`. Never inline `query_by`, `vector_query`, or `facet_by` in frontend code.
- Secrets: only `VITE_*` values reach the browser, and the Typesense key must be the **search-only** key. If you ever see an admin key in `frontend/`, stop and flag it.

---

## 3. What already exists (do not rebuild)

A `data/` pipeline and a Typesense cluster are already set up by teammates. You consume them.

- `frontend/public/manifest.json` — per-model layer counts and index sizes. Load once at startup.
- Typesense collections `features_fast` (all ~1.5M features, keyword) and `features_deep` (~59k sampled features, hybrid semantic with server-side embeddings).
- Typesense presets `roamer_fast` and `roamer_deep` — already tuned.
- Env in `frontend/.env`: `VITE_TYPESENSE_HOST`, `VITE_TYPESENSE_PORT`, `VITE_TYPESENSE_PROTOCOL`, `VITE_TYPESENSE_SEARCH_KEY`, `VITE_NEURONPEDIA_API_KEY`.

If `manifest.json` or the env vars are missing, hardcode `gemma-2-2b: 26 layers / 16384 wide` and `llama3.1-8b: 32 layers / 32768 wide`, render the scene with mock data, and keep building. Never block on missing data.

---

## 4. Data contracts

### 4.1 Typesense — concept search

```ts
POST {protocol}://{host}:{port}/multi_search
Header: X-TYPESENSE-API-KEY: <search-only key>
{
  "searches": [
    { "collection": "features_fast", "preset": "roamer_fast", "q": "protein folding", "filter_by": "model:=gemma-2-2b" }
  ]
}
```

Deep mode: `collection: "features_deep"`, `preset: "roamer_deep"`. Compare view: push one search object per model into the same array — one round trip, results come back in request order.

Response, per search — you need exactly three things:

```jsonc
{
  "found": 143,                       // total matches → density term of the score. Never page.
  "search_time_ms": 9,
  "facet_counts": [ { "field_name": "layer", "counts": [ { "value": "12", "count": 31 }, ... ] } ],
  "hits": [ {
    "document": { "id": "gemma-2-2b_12_4232", "model": "gemma-2-2b", "layer": 12, "index": 4232,
                  "description": "references to protein folding and tertiary structure",
                  "np_url": "https://www.neuronpedia.org/gemma-2-2b/12-gemmascope-res-16k/4232" },
    "text_match": 578730123365187705,
    "vector_distance": 0.31,                              // deep only
    "hybrid_search_info": { "rank_fusion_score": 0.85 },  // deep only
    "highlight": { "description": { "snippet": "... <mark>protein folding</mark> ..." } }
  } ]
}
```

Relevance for glow intensity: `rel = vector_distance != null ? max(0, 1 - vector_distance) : 1 - i / hits.length`.

### 4.2 Neuronpedia — run a sentence (token activations)

```ts
POST https://www.neuronpedia.org/api/search-all
Header: x-api-key: <VITE_NEURONPEDIA_API_KEY>
{
  "modelId": "gemma-2-2b",
  "sourceSet": "gemmascope-res-16k",     // llama3.1-8b → "llamascope-res-32k"
  "text": "The protein misfolded into amyloid plaques.",
  "selectedLayers": [], "sortIndexes": [], "ignoreBos": true, "numResults": 50
}
```

Response:

```jsonc
{
  "tokens": ["<bos>", "The", " protein", " misfolded", ...],
  "result": [ { "modelId": "gemma-2-2b", "layer": "12-gemmascope-res-16k", "index": "4232",
                "values": [0, 0, 6.2, 11.4, ...],   // one activation per token, aligned to tokens[]
                "maxValue": 11.4, "maxValueIndex": 3 } ]
}
```

Parse `layer` with `parseInt(layer.split("-")[0])` and `index` with `parseInt(index)`. **`values[]` aligned to `tokens[]` is what makes token clicking work** — clicking token *t* means filtering `result` to features where `values[t] > 0`, sorted by `values[t]` descending.

This is rate-limited: one call per explicit button press. Never on keystroke, never on token click (the data is already in the response).

### 4.3 Neuronpedia — feature detail (lazy, on click)

```
GET https://www.neuronpedia.org/api/feature/{modelId}/{layer}-{sourceSet}/{index}
```
Returns the feature's explanations, top-activating text snippets, and logit effects. Fetch only when a detail drawer opens, cache by feature id in a `Map`, show a skeleton while loading. If it fails, the drawer still shows the description and `np_url` you already have — never let this break the scene.

---

## 5. Types (define these first, in `src/types.ts`)

```ts
export type ModelId = "gemma-2-2b" | "llama3.1-8b";
export type Mode = "fast" | "deep";
export type View = ModelId | "compare";
export type Tab = "concept" | "sentence";

export interface Manifest {
  models: Record<ModelId, {
    display: string; n_layers: number; width: number;
    fast: { total: number; per_layer: Record<string, number> };
    deep: { total: number; per_layer: Record<string, number> };
  }>;
}

export interface Hit {
  id: string; model: ModelId; layer: number; index: number;
  description: string; np_url: string;
  rel: number;              // 0..1, drives glow
  snippet?: string;         // highlighted HTML
}

export interface Result {
  model: ModelId; found: number; perLayer: Record<number, number>;
  hits: Hit[]; score: number; layersHit: number; ms: number;
}

export interface PinnedConcept { id: string; q: string; mode: Mode; color: string; results: Partial<Record<ModelId, Result>>; }

export interface TokenRun {
  model: ModelId; text: string; tokens: string[];
  features: { layer: number; index: number; values: number[]; maxValue: number; maxValueIndex: number }[];
}
```

---

## 6. Coverage score (the number judges read)

```ts
export const D0 = { fast: 2.0, deep: 6.0 };   // single tuning point; a teammate calibrates this

export function coverage(found: number, perLayer: Record<number, number>, indexed: number, nLayers: number, mode: Mode) {
  const density = found / (indexed / 1000);            // hits per 1,000 indexed features
  const layersHit = Object.keys(perLayer).length;
  const spread = layersHit / nLayers;
  const score = Math.round(100 * Math.min(1, Math.sqrt(density / D0[mode])) * (0.5 + 0.5 * spread));
  return { score, layersHit, density, spread };
}
```

`indexed` comes from `manifest.models[model][mode].total`. Normalizing by index size is what makes Gemma and Llama comparable, and Fast and Deep comparable despite Deep being a sample. Plain-English label for the UI: *how many features fire for this concept, normalized by model size, weighted by how many layers it spans.*

Per-layer bar: `perLayer[L] / max(perLayer)` for every `L in 0..nLayers-1`, **zeros included** — the gaps are information.

---

## 7. Node placement (`src/layout.ts`, write this verbatim)

```ts
export const R = 4, LAYER_GAP = 0.9, SCAFFOLD_PER_LAYER = 200;

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function nodePosition(model: string, layer: number, index: number): [number, number, number] {
  const rnd = mulberry32(hash32(`${model}:${layer}:${index}`));
  const a = rnd() * Math.PI * 2, r = R * Math.sqrt(rnd());
  return [r * Math.cos(a), layer * LAYER_GAP, r * Math.sin(a)];
}
// scaffold uses synthetic indices so it never collides with real features
export function scaffoldPositions(model: string, nLayers: number): Float32Array { /* index = 1_000_000 + i */ }
```

---

## 8. Build order — verify each phase before moving on

### Phase 1 — Skeleton (target: 20 min)
Vite React-TS project. `types.ts`, `layout.ts`, `coverage.ts`, `store.ts` (zustand), `search.ts`. Dark shell (`#0b0f1a`), header with the two tab buttons, empty `<Canvas>` with `OrbitControls`, right-hand panel column.
**Verify:** app loads, no console errors, `nodePosition("gemma-2-2b",12,4232)` logs the identical tuple twice.

### Phase 2 — Static model (target: 30 min)
`ModelStack`: `nLayers` translucent discs (`circleGeometry` r=4, rotated flat, `y = L * LAYER_GAP`), rim labels every 5th layer, one `<Points>` of scaffold dots (200/layer, `useMemo`, built once). Slow idle auto-rotate that stops on interaction.
**Verify:** 26 discs for Gemma, 32 for Llama, 60 fps, orbit smooth.

### Phase 3 — Concept search → glow  ← **THE CORE. Everything after this is optional.**
Search bar (250 ms debounce, Enter searches now), Fast|Deep toggle, Gemma|Llama|Compare toggle, all wired to `searchModels()`. Lit features render as one drei `<Instances>` of spheres (r=0.06, `scale = 0.6 + 0.8*rel`, `emissiveIntensity = 0.5 + 2.5*rel`). ScorePanel: big score, per-layer bar, and the line `{found} features · {layersHit}/{nLayers} layers · {Mode} · {ms} ms`. URL hash sync (`#tab=concept&q=protein%20folding&mode=deep&view=compare`) so a reload restores the demo.
**Verify:** typing "protein folding" lights nodes within 100 ms of the response; the score matches what the CLI reports for the same query; reload with the hash restores everything.

### Phase 4 — Motion
Four animations, in this priority order. Each must be skippable behind a `prefers-reduced-motion` check and a `motion: on/off` store flag.
1. **Ignition cascade** — on new results, nodes scale-in and brighten bottom layer upward, ~25 ms stagger per layer, ~500 ms total. Drive it in one `useFrame` with a shared clock and a per-instance delay attribute. Do not use one `useSpring` per node.
2. **Signal pulse** — a soft ring/plane sweeps up the stack every ~6 s when idle, brightening lit nodes as it passes. One shader uniform or one lerped y-position; not 250 state updates.
3. **Camera fly-to** — clicking a bar in the per-layer chart or dragging the layer slider eases the camera to that layer's height over ~700 ms (lerp target + position, `easeInOutCubic`), then hands control back to `OrbitControls`.
4. **Token beams** — Phase 5.

**Verify:** 55+ fps with 250 lit nodes and animations running, in Compare view.

### Phase 5 — Run a sentence (second tab)
Textarea + model picker + **Run** button (explicit; never auto-fire). On response, render `tokens[]` as a horizontal strip of clickable chips above the canvas. All features from the run light up dimly.

Click a token *t*:
- filter `features` to `values[t] > 0`, sort desc, take top ~30
- those nodes brighten; everything else dims to ~15%
- draw **beams**: a thin animated line (drei `<Line>` or a `TubeGeometry`) from the token chip's screen position projected into the scene, or from a fixed anchor below the stack, up to each lit node — with a traveling highlight along the beam
- panel shows those features' descriptions, ranked by activation, with the raw activation value

Token chip styling: background opacity ∝ that token's max activation across all features, so the sentence itself reads as a heatmap before anything is clicked.
**Verify:** "The protein misfolded into amyloid plaques." → clicking ` misfolded` lights a visibly different set than clicking ` The`. Beams ≤30, still 55 fps.

### Phase 6 — Extras, in this order, cut from the bottom
1. **Layer slider** — vertical slider beside the canvas; scrubbing isolates a layer (others fade to 8%), camera follows, panel shows that layer's hits. Double-click resets to all layers.
2. **Feature detail drawer** — clicking a node opens a right-side drawer: description, all explanations, activation value if from a token run, top-activating text snippets from §4.3 (lazy + cached + skeleton), and a link to `np_url`. Esc closes. This replaces any label-only click behavior.
3. **Pin & compare concepts** — a pin button stores the current query as a `PinnedConcept` with a color from a fixed palette (`#4cc9f0`, `#f72585`, `#ffd166`); up to 3. Pinned concepts render simultaneously in their own colors; a node matched by more than one gets a white core. Chips at the top show `{q} · {score}` with an × to remove.
   **Color policy:** color encodes *concept*, never model. Models are distinguished by stack position and height in Compare view, plus their label. Do not color by model anywhere.
4. **Guided tour** — a `?` button runs a scripted 5-step overlay: (1) "this is one model, 26 layers of features" (2) run `protein folding`, point at the score (3) switch to Compare, point at the gap (4) switch to Deep with `how cells repair damaged DNA`, point out that no keyword matches (5) sentence tab, click ` misfolded`. Each step: a caption, an auto-filled action, a Next button. Drive it from the same store actions a user would trigger — no separate code path.

---

## 9. Layout, color, motion, interaction

All of it is specified in **`VISUAL-DIRECTION.md`** — §1 palette, §3 how the model is drawn, §4 the four animations with their timings and easing, §5 the full hover/click/keyboard map, §6 the HUD, §7 empty and error states. Build from that document; don't invent a look here.

The two things worth restating because they get violated by habit:

- **The background is `#000000` and nothing on screen has a container.** No cards, borders, panel backgrounds, or shadows. HUD text floats directly on the void.
- **Everything visible is clickable** — nodes, layer rings, layer labels, per-layer bars, token chips, concept chips — and the bar chart and the 3D stack are the same control: clicking either highlights both.

Sentence tab: same void, the search row replaced by a textarea + Run, and the token strip floating directly above the stack.

---

## 10. Performance rules (these are why it will or won't run)

- One `<Points>` for all scaffold dots per model. One `<Instances>` for all lit nodes. Never a component per feature.
- Animate inside `useFrame` by mutating instance matrices/colors. **Never** put per-frame values in React state.
- `useMemo` scaffold geometry on `[model, nLayers]`. It must not rebuild on search.
- Cap: 250 lit nodes (Typesense `per_page` max), 30 beams, 8 floating labels.
- Sphere segments 12. `MeshBasicMaterial` only — no lights, no `MeshStandardMaterial`, no shadows anywhere (this is both the visual spec and the fastest path). Bloom (`@react-three/postprocessing`) only after everything works and you've measured ≥55 fps without it.
- Raycast lit nodes only, throttled to ~30 Hz. Never raycast the scaffold `<Points>`; give it `raycast = () => null`.
- Measure with the drei `<Stats>` overlay behind a `?stats=1` query param.

---

## 11. Failure behavior

Every one of these degrades, never crashes:

| Failure | Behavior |
|---|---|
| Typesense unreachable | Inline banner "search unavailable", scene keeps its last results |
| 0 results in Fast | One-line hint: "Exact mode found nothing — try fewer words or Deep mode." No modal. |
| Neuronpedia 429 / error | Toast on the Run button, sentence tab stays usable with prior run |
| Feature detail 404 | Drawer shows description + link only |
| `manifest.json` missing | Fall back to hardcoded layer counts, log a warning |
| WebGL unavailable | Render the 2D fallback: `nLayers` CSS rows of dots, lit ones colored. Same data, same score. |

---

## 12. Definition of done

- [ ] Both tabs work end to end against the live services
- [ ] Concept search: type → glow → score, under 100 ms after the response returns
- [ ] Sentence run: click a token → a *different, sensible* feature set with beams
- [ ] Compare view renders both models, ≥55 fps
- [ ] All four animations run and can be turned off
- [ ] Layer slider, detail drawer, pinned concepts, and tour all work — or are cleanly absent, not half-wired
- [ ] URL hash restores tab, query, mode, view, pinned concepts
- [ ] Background is pure black; there is not one container, border, or card anywhere in the UI
- [ ] Orbit, zoom, and pan all work; every target in `VISUAL-DIRECTION.md` §5 responds to hover and click; keyboard shortcuts work
- [ ] Clicking a per-layer bar highlights the matching layer ring in 3D, and vice versa
- [ ] `npm run build` clean, zero TS errors, no `any` in API types
- [ ] No admin key anywhere in `frontend/`

---

## 13. How to work

1. Restate your plan in ≤6 bullets, then build. Don't ask questions this document answers.
2. Build phase by phase. After each phase, run it, state what you verified, and commit with the phase name.
3. Use mock data (a `hits.mock.ts` with ~40 fake hits across random layers) to build Phases 2–4 in parallel with real services being ready. Swap to real data behind the same store shape.
4. Time-box any blocker to 15 minutes, then take the failure behavior from §11 and keep moving.
5. If something here is wrong or impossible, say so in one sentence and proceed with the closest workable thing. Don't stall.
