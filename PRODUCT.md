# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: a stranger arriving alone at a hosted URL, with no narrator.** Confirmed 2026-09-09. Nobody explains the screen to them, so everything needed to understand what they are looking at has to be present in the interface itself.

Who that stranger is, per the project brief: an engineer, researcher, or student evaluating a small, domain-specific language model — someone deciding whether to adopt Gemma 2 2B or Llama 3.1 8B for their field, or deciding where an adapter should be targeted. They arrive with a concept from their own domain in mind ("protein folding", a clinical phrase, a legal term) and want to know whether the model represents it.

Secondary, still real: the author demonstrating the project. This was the sole audience through 2026-09-08 and the shipped interface is still shaped around it.

**The shift this record exists to capture.** RomirAI was built for the Typesense "Solve by Search" hackathon at Purdue on 2026-09-08, for a narrated demo on localhost. That evening is over. The primary user is now the unaccompanied visitor, and the interface has not yet been reworked for one. Treat every place that assumes a narrator as a gap, not a decision.

## Product Purpose

Let someone **see inside a language model by searching it**, and answer one question with it: *does this model actually represent my field's concepts, and where in the network?*

Interpretability work has decomposed Gemma 2 2B and Llama 3.1 8B into sparse-autoencoder (SAE) features, each carrying a plain-English description of what it fires on. RomirAI indexes ~1.5M of those descriptions in Typesense. The visitor types a concept; every feature encoding it lights up inside a 3D map of the model, with a coverage score and a per-layer distribution.

Success is the visitor leaving with a defensible read on a real adoption decision — strong / partial / weak / absent, and which layers carry it — not merely having watched something move.

## Positioning

The mechanism a neighboring product could not truthfully copy: **the model's own learned features are the search index.** There is no application server and no GPU in the path. Typesense *is* the backend, queried directly from the browser, and the thing being searched is a decomposition of the network itself rather than documentation about it.

Two modes, both user-facing and meaningfully different: **Fast** is exact keyword search across every feature (every query word must appear in a description); **Deep** is Typesense hybrid semantic search over a per-layer sample, which is the only mode where multi-word clinical or technical phrases land.

The read offered on top of the raw hits is also positional: early layers carry tokens and surface form, middle layers carry concepts, late layers shape output for the task. An empty middle band means prompt engineering will not conjure the concept — that is a fine-tuning job. That interpretation lives in `frontend/src/advice.ts`.

## Operating Context

- **Today:** Vite dev server on localhost:5173 against a local Typesense container (`roamerai-ts`, port 8108). `frontend/.env.example` still points at `localhost`.
- **Screen size is a real constraint.** The model and its reading have to sit side by side; below ~820px the interface shows a notice saying so instead of stacking its panels. A genuine small-screen layout has not been designed, and the notice is a deliberate placeholder, not a decision that phones are out of scope forever.
- **Required for the primary user:** a hosted URL. No deploy configuration exists in the repo yet (no Vercel/Netlify/Docker/CI config), and the Typesense instance the hosted build would query is undecided. This is an open decision, not a solved one.
- The visitor arrives cold, on unknown hardware, and types a concept from a domain the author does not know.
- Data is generated offline by `pull_data.py` → `data/*.jsonl` + `manifest.json`, indexed by `index_typesense.py`. `data/` is generated and never committed or hand-edited.
- Team of three plus AI coding agents; `AGENTS.md` governs agent contributions.

## Capabilities and Constraints

**Shipped** (`frontend/src`): concept search with a debounced query; single-model view for either model plus a Compare view; a coverage score 0–100 with a per-layer bar, tick column, and PCA plot per layer; layer isolation by clicking a ring, tick, or bar; hover readout; a stack or globe layout toggle; orbit/pan drag modes; camera reset; a diagram-only focus mode that hides every panel but search and legend; a cross-model counterpart search (one feature, its nearest analogues in the other model); a Sources drawer of Neuronpedia links; the banded verdict in `advice.ts`.

**Not shipped, despite appearing in the briefs:** the "run a sentence" / live-activation mode (tokenize a sentence, run it through the model via Neuronpedia's `search-all`, draw beams for the features a token fired). It was always a stretch item. Neuronpedia appears in the shipped code only as per-feature links. Do not describe it as existing.

**Binding constraints, reconfirmed 2026-09-09:**

- **No backend.** The browser talks to Typesense (and, if ever used, Neuronpedia) directly with a search-only key scoped to `documents:search`. No app server, no route handlers, no proxy — except a Vite dev proxy if CORS forces one.
- **The two models are fixed.** Gemma 2 2B (26 layers, 16,384 features/layer, Gemma Scope res-16k) and Llama 3.1 8B (32 layers, 32,768 features/layer, Llama Scope res-32k). The coverage formula in `01-architecture.md` §6 stays as it is.
- **There is no search mode any more.** Fast (keyword) mode was removed on 2026-09-09, reversing the constraint recorded earlier that day. It defaulted on, it required every query word to appear verbatim in a description, and so the first thing an unaccompanied visitor did with their own vocabulary was fail. Hybrid semantic search (`features_deep` / `roamer_deep`) is the only path. `features_fast` and the `roamer_fast` preset still exist server-side and are simply unused.
- **55+ fps on an integrated laptop GPU is a requirement, not a goal.** It constrains what any visual work may add.
- Search parameters live in Typesense presets (`roamer_fast`, `roamer_deep`), server-side. The browser sends only `{collection, preset, q, filter_by}`.
- Deep mode is a per-layer sample by design (time and RAM). Never embed all 1.5M features.
- A feature's 3D position is a pure function of `(model, layer, index)` — same feature, same spot, every search, every reload.
- TypeScript strict; no `any` on Typesense response types.
- Never ship the admin key to the browser. `VITE_TYPESENSE_SEARCH_KEY` is search-only.

**Terminology** (use these words, they are the domain's): *feature* (one SAE direction, not a neuron), *layer*, *coverage score*, *fast* / *deep*, *matched* vs *scaffold* features, *counterpart*, *early / middle / late band*.

**Open decisions:** hosting target and the Typesense instance behind it; whether the sentence/live-activation mode is ever built; whether the search-only key's exposure and Typesense Cloud rate limits are acceptable under public traffic.

## Brand Commitments

- **Name:** RomirAI.
- **`VISUAL-DIRECTION.md` is binding as written.** The user reconfirmed this on 2026-09-09. It is the project's visual authority even though it is not named `DESIGN.md`. Its rule: the screen is black and the model is the only thing in it — pure black void, the Manim-derived palette with fixed colour meanings, no panels, cards, borders, shadows, rounded containers, or gradients; text floating directly on the void; flat emissive materials and no lights; fade-in/transform motion with stagger. Do not expand, reinterpret, or split the difference with it.
- **`ASTRA-PROMPT.md` §2 defers to it:** where the build prompt and the visual direction differ on appearance, the visual direction wins.

## Evidence on Hand

- Real data, at real scale: ~1.5M SAE feature descriptions from Neuronpedia (425,984 Gemma fast / ~26,624 Gemma deep / 1,048,576 Llama fast / ~32,768 Llama deep), with per-layer counts in `manifest.json`. Descriptions are GPT-4o-mini autointerp from Neuronpedia, not written here.
- Every feature carries a real `np_url` back to its Neuronpedia page — the claims are checkable by the visitor.
- A working interactive build in `frontend/`, running locally.
- Project documentation: `README.md`, `01-architecture.md` (system diagram, schema, search contract, coverage formula), `03-typesense.md`, `AGENTS.md`, `ASTRA-PROMPT.md`, `VISUAL-DIRECTION.md`.

**Absences future work must not fabricate:** no users, adopters, testimonials, press, benchmark results, or hackathon outcome are recorded here. No deployment exists. No accuracy or evaluation study has been run against the coverage score. Do not claim, in UI copy or anywhere else, that coverage means "no hallucinations."

**On the coverage constant.** `D0` was retuned from 6 to 16 on 2026-09-09 against measured hit counts from the live index. At 6 the score saturated: "sepsis", "unit tests", "climate model" and "contract law" all returned a flat 100, and every verdict read "well represented". The deep preset caps its vector pool at `k=600`, so density tops out at 22.6 (Gemma) and 18.4 (Llama); 16 puts saturation just under the ceiling both can reach. Measured afterwards: sepsis 62, tax filing 34, protein folding 24, kubernetes 22. The formula is unchanged — this is the constant the architecture doc marks TUNE. It still has no evaluation behind it, and the UI now says so in the walkthrough.

## Product Principles

1. **The stranger has no narrator.** Anything only comprehensible because someone was talking over it is unfinished. This is the standing test for every change from here.
2. **Answer the adoption question, not just the search.** The screen has to resolve to a verdict a person could act on — strong/partial/weak/absent and which layers — not to a count of hits.
3. **Claims stay checkable and stay honest.** Every lit feature traces to a real Neuronpedia page; the coverage score is a heuristic with an untuned constant and is described as one.
4. **Typesense is the backend.** No server appears, ever. Relevance is tuned in presets, not in frontend code.
5. **The void is not negotiable.** Fidelity to `VISUAL-DIRECTION.md` outranks convenience, and 55 fps on a modest GPU outranks any effect.
