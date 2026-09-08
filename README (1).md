# RoamerAI

**Search a concept. Watch the neurons that encode it light up. Know before you adopt a small model whether it actually represents your field.**

Built for the Typesense "Solve by Search" hackathon at Purdue (Sept 8, 2026, 5:30–10:15 PM).

## What this folder is

A hand-off kit for a 3-person team plus AI coding agents. Everything an agent needs to build RoamerAI is here; nothing needs to be re-decided.

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

## One-paragraph pitch

Teams adopting a small, domain-specific LLM (for speed, cost, and fewer hallucinations) have no quick way to check whether that model has actually learned their field's concepts. RoamerAI indexes ~1.5M human-readable descriptions of sparse-autoencoder features from Gemma 2 2B and Llama 3.1 8B into Typesense. Type "protein folding" and the features that encode it glow inside a 3D map of the model, with a coverage score and a per-layer bar. Switch models to compare. Fast mode is exact keyword search over everything; Deep mode is Typesense hybrid semantic search. Nothing runs on a GPU.
