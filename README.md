# RomirAI

**Search a concept. Watch the neurons that encode it light up. Know before you adopt a small model whether it actually represents your field.**

Built for the Typesense "Solve by Search" hackathon at Purdue (Sept 8, 2026, 5:30–10:15 PM).

## What this folder is

A hand-off kit for a 3-person team plus AI coding agents. Everything an agent needs to build RomirAI is here; nothing needs to be re-decided.

```
roamerai/
├── README.md              ← you are here: orientation + read order
├── AGENTS.md              ← rules of engagement for AI agents (read second)
├── .env.example           ← every secret/config the project needs
├── docs/
│   ├── 00-brief.md        ← what we're building, for whom, pitch, judging map
│   ├── 01-architecture.md ← system diagram, data flow, schemas, coverage score
│   ├── 02-data-pipeline.md← where data lives, pull + index commands, verification
│   ├── 03-typesense.md    ← exactly which Typesense features, queries, tuning knobs
│   ├── 04-frontend.md     ← R3F scene spec, components, state, UI layout
│   └── 05-plan.md         ← tonight's timeline, roles, cut lines, demo script
├── tasks/                 ← agent-sized task cards with acceptance criteria (T01–T09)
├── scripts/
│   ├── pull_data.py       ← Neuronpedia → data/*.jsonl + manifest.json
│   ├── index_typesense.py ← collections, presets, synonyms, key, bulk import
│   └── requirements.txt
└── data/                  ← generated (gitignore it)
```

## Read order

| Who | Read |
|---|---|
| Everyone, 5 min | `docs/00-brief.md`, `docs/05-plan.md` |
| Data/search person | `docs/02-data-pipeline.md`, `docs/03-typesense.md`, tasks T01–T04 |
| Frontend person | `docs/01-architecture.md`, `docs/04-frontend.md`, tasks T05–T08 |
| Glue/pitch person | `docs/01-architecture.md`, `docs/05-plan.md`, task T09 |
| Any AI agent | `AGENTS.md` first, then the task card you were given, then the docs it links |

## Do this before 5:30 PM (critical path)

```bash
pip install -r scripts/requirements.txt
python scripts/pull_data.py --dry-run                 # 10 s: confirms bucket access + file counts
python scripts/pull_data.py                           # full pull, both models (minutes, network-bound)
```
In parallel: create the Typesense Cloud cluster (see `docs/02-data-pipeline.md` § Cluster), copy `.env.example` → `.env`, fill keys, then:
```bash
python scripts/index_typesense.py setup               # collections + presets + synonyms + search-only key
python scripts/index_typesense.py import fast &       # ~1.5M docs, keyword only
python scripts/index_typesense.py import deep         # ~58k docs, server-side embeddings (slower)
python scripts/index_typesense.py search "protein folding" --mode deep --model gemma-2-2b
```

## Run it now (local Typesense, no cloud account)

```bash
# 1. data: Neuronpedia -> data/*.jsonl + manifest.json  (~2 min, network-bound)
pip install -r scripts/requirements.txt
python pull_data.py

# 2. search backend: one container is the whole backend
docker run -d --name roamerai-ts -p 8108:8108 -v /tmp/typesense-data:/data \
  typesense/typesense:30.2 --data-dir /data --api-key=roamerai-dev-admin --enable-cors
cp .env.example .env

# 3. collections, presets, synonyms, and the search-only key (printed once)
python index_typesense.py setup
python index_typesense.py import fast     # ~1.5M docs, ~90 s
python index_typesense.py import deep     # ~59k docs, server-side embeddings, ~4 min

# 4. frontend
cd frontend
cp .env.example .env                      # paste the search-only key from step 3
npm install && npm run dev                # http://localhost:5173
```

Sanity check without the browser:
`python index_typesense.py search "protein folding" --mode deep --model gemma-2-2b`

## Using it

Type a concept from your field. Every SAE feature whose description encodes it
lights up in the 3D map, and the right rail answers the actual question: is this
model's grasp of the concept strong enough to ship, and if not, which layers
should an adapter target. **Fast** requires every query word to appear in a
feature description; **deep** matches meaning, which is the only way multi-word
clinical phrases land. Click any layer — in the stack, the tick column, or the
bar chart — to fly to it and read what matched there.

## Deploy (Vercel)

The frontend is a static Vite build; there is no server. Vercel serves the bundle,
and the browser queries Typesense Cloud directly with a search-only key.

**Vercel project settings**

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework | Vite (detected; `frontend/vercel.json` pins it) |
| Build Command | `npm run build` |
| Output Directory | `dist` |

**Environment variables** — set all four for Production and Preview *before* the
first build. Vite inlines `VITE_*` at build time, so changing one needs a redeploy.

```
VITE_TYPESENSE_HOST=<cluster>.a1.typesense.net
VITE_TYPESENSE_PORT=443
VITE_TYPESENSE_PROTOCOL=https
VITE_TYPESENSE_SEARCH_KEY=<search-only key from `index_typesense.py setup`>
```

The search-only key ships inside the JavaScript bundle. That is what it is for —
it is scoped to `documents:search` on `features_*` and can do nothing else. The
admin key must never appear here.

**The cluster needs the data.** Point `.env` at the Cloud cluster and run
`python index_typesense.py setup`, then `import deep` (~4 min). Deep is the only
collection the app queries now; `import fast` is optional.

## One-paragraph pitch

Teams adopting a small, domain-specific LLM (for speed, cost, and fewer hallucinations) have no quick way to check whether that model has actually learned their field's concepts. RomirAI indexes ~1.5M human-readable descriptions of sparse-autoencoder features from Gemma 2 2B and Llama 3.1 8B into Typesense. Type "protein folding" and the features that encode it glow inside a 3D map of the model, with a coverage score and a per-layer bar. Switch models to compare. Fast mode is exact keyword search over everything; Deep mode is Typesense hybrid semantic search. Nothing runs on a GPU.
