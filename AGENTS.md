# AGENTS.md — how AI agents work in this repo

You are one of several agents (and three humans) building RomirAI in a single evening. Optimize for **a working demo at 10:15 PM**, not for elegance.

## 1. Before you write anything

1. Read `README.md` and the task card you were assigned in `tasks/`.
2. Read only the docs your task card links. Don't read everything.
3. State your plan in ≤5 bullets, then build. Don't ask questions the docs already answer.
4. If the docs contradict each other, `docs/01-architecture.md` wins, then `docs/03-typesense.md`, then the rest.

## 2. Fixed decisions (do not re-open)

| Decision | Value | Where |
|---|---|---|
| Models | `gemma-2-2b` (26 layers) and `llama3.1-8b` (32 layers), switchable, plus Compare | 00-brief |
| Nodes | SAE features (Gemma Scope res-16k, Llama Scope res-32k) | 01-architecture |
| Search modes | **Fast** = keyword over all features; **Deep** = hybrid semantic over ~1k/layer sample; user-facing toggle | 03-typesense |
| Embeddings | Typesense built-in `ts/all-MiniLM-L12-v2` | 03-typesense |
| Search backend | Typesense Cloud, called **directly from the browser** with a search-only key. No app server. | 01-architecture |
| Frontend | Vite + React + TypeScript + react-three-fiber | 04-frontend |
| 3D | Stacked translucent layer discs, ~200 faint scaffold dots per layer, matched features glow | 04-frontend |
| Click a node | Glow + label only (no detail panel in v1) | 04-frontend |
| Coverage | Score 0–100 + per-layer bar, formula in 01-architecture §6 | 01-architecture |
| Demo runs | Localhost on a laptop | 05-plan |
| Live activations | Stretch only, via Neuronpedia `POST /api/search-all` (no GPU) — decide at 9:15 | 05-plan |

Changing any of these costs the team time. If you believe one is wrong, say so in one sentence and proceed with the fixed value anyway.

## 3. Conventions

- **Schema is law.** The document shape in `docs/01-architecture.md` §4 is what the pull script writes and Typesense stores. If you need a new field, add it in `scripts/pull_data.py`, `scripts/index_typesense.py` `BASE_FIELDS`, and the doc, in the same commit.
- **Search params live in Typesense presets** (`roamer_fast`, `roamer_deep`), not in frontend code. The browser sends `{collection, preset, q, filter_by}` only. Tune relevance in `index_typesense.py PRESETS`, re-run `setup`.
- **Secrets:** admin key only in `.env` (server-side scripts). Browser gets the search-only key via `VITE_TYPESENSE_SEARCH_KEY`. Never commit `.env`.
- **Data dir** `data/` is generated; never hand-edit; never commit.
- **TypeScript:** strict on, no `any` on the Typesense response types (see `docs/04-frontend.md` §5 for the types).
- **Commits:** small, one task card per PR/commit, message = task id + what (`T05: layer discs + scaffold`).
- **Deterministic visuals:** node position is a pure function of `(model, layer, index)`. Same feature, same spot, every search.

## 4. Definition of done (every task)

- Acceptance criteria on the task card pass, verified by you (run it, don't assume).
- `npm run build` (frontend) or the script's `--help` (python) runs clean.
- You wrote a 3-line handoff at the bottom of your task card: what works, what doesn't, what the next person should know.

## 5. Don'ts

- Don't add a backend/API server. Typesense is the backend.
- Don't embed all 1.5M features. Deep mode is a sample by design (time + RAM).
- Don't introduce postprocessing/bloom before the core loop works (search → hits → glow → score). It's a 9:00 PM polish item.
- Don't claim in UI copy that coverage = "no hallucinations". Use the wording in `docs/00-brief.md` §5.
- Don't call Neuronpedia's API in the hot path. Everything the demo needs is already in Typesense.
- Don't page through results to count hits. Use `found` + `facet_counts` (see 03-typesense §4).

## 6. When you're stuck

Time-box to 15 minutes. Then: fall back to the simpler option listed on your task card under "Fallback", note it in the handoff, move on. A lit-up 2D layer list beats a broken 3D scene.
