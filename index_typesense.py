#!/usr/bin/env python3
"""
RoamerAI — Typesense indexing
=============================

Creates the two collections, the two search presets, domain synonyms, a
search-only API key for the frontend, then bulk-imports data/*.jsonl.

Uses the raw Typesense REST API via `requests` (no client-library version drift;
every call maps 1:1 to the curl examples in the Typesense docs).

Env (see .env.example):
  TYPESENSE_HOST      e.g. xyz-1.a1.typesense.net   (Typesense Cloud) or localhost
  TYPESENSE_PORT      443 (cloud) / 8108 (local)
  TYPESENSE_PROTOCOL  https / http
  TYPESENSE_ADMIN_KEY admin key (never ship to the browser)

Usage:
  python scripts/index_typesense.py setup                 # collections + presets + synonyms + search key
  python scripts/index_typesense.py import fast           # import data/*.fast.jsonl -> features_fast
  python scripts/index_typesense.py import deep           # import data/*.deep.jsonl -> features_deep (embeds on server)
  python scripts/index_typesense.py import fast --models gemma-2-2b
  python scripts/index_typesense.py status                # doc counts
  python scripts/index_typesense.py search "protein folding" --mode deep --model gemma-2-2b
  python scripts/index_typesense.py reset                 # DROP both collections (asks to confirm)

Run `setup` once, then `import fast` and `import deep` can run concurrently in two terminals.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

# ----------------------------------------------------------------------------- config
def load_dotenv(path: Path = Path(".env")) -> None:
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_dotenv()
HOST = os.environ.get("TYPESENSE_HOST", "localhost")
PORT = os.environ.get("TYPESENSE_PORT", "8108")
PROTOCOL = os.environ.get("TYPESENSE_PROTOCOL", "http")
ADMIN_KEY = os.environ.get("TYPESENSE_ADMIN_KEY", "")
BASE = f"{PROTOCOL}://{HOST}:{PORT}"
HEADERS = {"X-TYPESENSE-API-KEY": ADMIN_KEY}

FAST = "features_fast"
DEEP = "features_deep"
PRESET_FAST = "roamer_fast"
PRESET_DEEP = "roamer_deep"
SYNONYM_SET = "roamer"                 # Typesense 29+ global synonym set, referenced from the presets
EMBED_MODEL = "ts/all-MiniLM-L12-v2"   # built-in, 384-dim, free, CPU-friendly

# ----------------------------------------------------------------------------- schemas
BASE_FIELDS = [
    {"name": "model", "type": "string", "facet": True},
    {"name": "layer", "type": "int32", "facet": True},
    {"name": "index", "type": "int32"},
    {"name": "description", "type": "string"},                       # primary explanation (keyword-indexed)
    {"name": "descriptions", "type": "string[]", "optional": True},  # all explanations for this feature
    {"name": "explainer", "type": "string", "facet": True, "optional": True},
    {"name": "source", "type": "string", "index": False, "optional": True},
    {"name": "np_url", "type": "string", "index": False, "optional": True},
]

SCHEMA_FAST = {"name": FAST, "fields": BASE_FIELDS}

SCHEMA_DEEP = {
    "name": DEEP,
    "fields": BASE_FIELDS + [
        {
            "name": "embedding",
            "type": "float[]",
            "embed": {"from": ["description"], "model_config": {"model_name": EMBED_MODEL}},
        }
    ],
}

# ----------------------------------------------------------------------------- presets
# Presets = server-stored search params. Frontend sends {preset, q, filter_by} and nothing else,
# so relevance tuning happens here without a frontend redeploy.
PRESETS = {
    PRESET_FAST: {
        "query_by": "description,descriptions",
        "query_by_weights": "3,1",
        "num_typos": 1,
        "typo_tokens_threshold": 1,
        "prefix": False,
        "drop_tokens_threshold": 0,      # multi-word query must match ALL words (precision)
        "facet_by": "layer",
        "max_facet_values": 64,          # >= n_layers so the per-layer bar is complete
        "per_page": 250,                 # Typesense max; enough to light up the scene
        "exclude_fields": "descriptions",
        "highlight_fields": "description",
        "synonym_sets": SYNONYM_SET,
    },
    PRESET_DEEP: {
        "query_by": "description,descriptions,embedding",
        "query_by_weights": "3,1,1",
        "num_typos": 1,
        "prefix": False,
        "drop_tokens_threshold": 0,
        # alpha: 0=keyword only .. 1=vector only. k: candidate pool. distance_threshold: cosine distance cutoff.
        "vector_query": "embedding:([], alpha: 0.6, k: 600, distance_threshold: 0.60)",
        "facet_by": "layer",
        "max_facet_values": 64,
        "per_page": 250,
        "exclude_fields": "embedding,descriptions",
        "highlight_fields": "description",
        "synonym_sets": SYNONYM_SET,
    },
}

# ----------------------------------------------------------------------------- synonyms
# Multi-way synonyms: searching any term matches all. Kept tight to avoid noise.
# Typesense 29+ stores these once globally as a "synonym set"; the presets opt in
# via `synonym_sets`, so both collections share one definition.
SYNONYMS = {
    # medicine / biology
    "mri": ["mri", "magnetic resonance imaging"],
    "ecg": ["ecg", "ekg", "electrocardiogram"],
    "bp": ["blood pressure", "hypertension"],
    "chemo": ["chemo", "chemotherapy"],
    "dna": ["dna", "deoxyribonucleic acid", "genome"],
    # law
    "scotus": ["scotus", "supreme court"],
    "ip": ["intellectual property", "patent", "copyright", "trademark"],
    "litigation": ["litigation", "lawsuit", "legal proceedings"],
    "contract": ["contract", "agreement", "terms and conditions"],
    # chemistry / physics
    "nmr": ["nmr", "nuclear magnetic resonance"],
    "qm": ["quantum mechanics", "quantum physics"],
    "thermo": ["thermodynamics", "heat transfer", "entropy"],
    "catalysis": ["catalyst", "catalysis", "catalytic"],
    # cs / math
    "ml": ["machine learning", "deep learning", "neural network"],
    "db": ["database", "sql", "query"],
    "regex": ["regex", "regular expression", "pattern matching"],
    "linalg": ["linear algebra", "matrix", "eigenvalue"],
    "pde": ["partial differential equation", "differential equation", "pde"],
}


# ----------------------------------------------------------------------------- http
def req(method: str, path: str, **kw) -> requests.Response:
    r = requests.request(method, BASE + path, headers=HEADERS, timeout=kw.pop("timeout", 60), **kw)
    return r


def ensure(r: requests.Response, ok=(200, 201), allow=(409,)) -> dict | None:
    if r.status_code in ok:
        return r.json() if r.text else None
    if r.status_code in allow:
        return None
    raise SystemExit(f"{r.request.method} {r.url} -> {r.status_code}: {r.text[:500]}")


# ----------------------------------------------------------------------------- commands
def cmd_setup(args) -> None:
    health = req("GET", "/health")
    ensure(health)
    print(f"typesense ok at {BASE}")

    for schema in (SCHEMA_FAST, SCHEMA_DEEP):
        r = req("POST", "/collections", json=schema)
        if r.status_code == 409:
            print(f"collection {schema['name']} exists")
        else:
            ensure(r)
            print(f"created collection {schema['name']}")

    for name, value in PRESETS.items():
        ensure(req("PUT", f"/presets/{name}", json={"value": value}))
        print(f"preset {name} upserted")

    items = [{"id": sid, "synonyms": terms} for sid, terms in SYNONYMS.items()]
    ensure(req("PUT", f"/synonym_sets/{SYNONYM_SET}", json={"items": items}))
    print(f"synonym set '{SYNONYM_SET}': {len(items)} entries (used by both presets)")

    # search-only key for the browser: can search these collections and nothing else.
    r = req("POST", "/keys", json={
        "description": "roamerai-search-only",
        "actions": ["documents:search"],
        "collections": ["features_.*"],
    })
    key = ensure(r)
    if key:
        print("\nSEARCH-ONLY KEY (put in frontend .env as VITE_TYPESENSE_SEARCH_KEY, shown once):")
        print("   ", key["value"])


def import_file(coll: str, path: Path, chunk_lines: int, timeout: int) -> tuple[int, int]:
    """Stream a JSONL file in chunks to /documents/import. Returns (ok, failed)."""
    ok = failed = 0
    buf: list[str] = []

    def flush() -> None:
        nonlocal ok, failed, buf
        if not buf:
            return
        body = "".join(buf)
        for attempt in range(4):
            r = req("POST", f"/collections/{coll}/documents/import",
                    params={"action": "upsert", "batch_size": 500},
                    data=body.encode("utf-8"), timeout=timeout)
            if r.status_code == 200:
                for line in r.text.splitlines():
                    if line.strip():
                        res = json.loads(line)
                        if res.get("success"):
                            ok += 1
                        else:
                            failed += 1
                            if failed <= 3:
                                print("   import error:", res.get("error", "")[:200], file=sys.stderr)
                buf = []
                return
            time.sleep(2 * (attempt + 1))
        raise SystemExit(f"import chunk failed repeatedly: {r.status_code} {r.text[:300]}")

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                buf.append(line if line.endswith("\n") else line + "\n")
            if len(buf) >= chunk_lines:
                flush()
                print(f"   {path.name}: {ok} ok / {failed} failed", flush=True)
    flush()
    return ok, failed


def cmd_import(args) -> None:
    coll = FAST if args.mode == "fast" else DEEP
    data = Path(args.data)
    files = sorted(data.glob(f"*.{args.mode}.jsonl"))
    if args.models:
        files = [p for p in files if p.name.split(".")[0] in args.models]
    if not files:
        raise SystemExit(f"no {args.mode} files in {data}/ — run scripts/pull_data.py first")
    # deep = server-side embedding generation per doc => smaller chunks, longer timeout
    chunk = 10_000 if args.mode == "fast" else 1_000
    timeout = 300 if args.mode == "fast" else 900
    t0 = time.time()
    for p in files:
        print(f"importing {p} -> {coll}")
        ok, failed = import_file(coll, p, chunk, timeout)
        print(f"   done: {ok} ok / {failed} failed ({time.time() - t0:.0f}s elapsed)")
    cmd_status(args)


def cmd_status(args) -> None:
    for coll in (FAST, DEEP):
        r = req("GET", f"/collections/{coll}")
        if r.status_code == 200:
            print(f"{coll}: {r.json().get('num_documents', 0):,} docs")
        else:
            print(f"{coll}: missing")


def cmd_search(args) -> None:
    coll, preset = (FAST, PRESET_FAST) if args.mode == "fast" else (DEEP, PRESET_DEEP)
    search = {"collection": coll, "preset": preset, "q": args.q}
    if args.model:
        search["filter_by"] = f"model:={args.model}"
    r = req("POST", "/multi_search", json={"searches": [search]})
    res = ensure(r)["results"][0]
    if "error" in res:
        raise SystemExit(res)
    print(f"found={res['found']}  search_time_ms={res.get('search_time_ms')}")
    facets = {c["value"]: c["count"] for f in res.get("facet_counts", []) for c in f["counts"]}
    print("per-layer:", dict(sorted(facets.items(), key=lambda kv: int(kv[0]))))
    for h in res["hits"][:12]:
        d = h["document"]
        extra = h.get("vector_distance")
        tm = h.get("text_match")
        print(f"  L{d['layer']:>2} #{d['index']:<6} vd={extra if extra is None else round(extra, 3)} tm={tm}  {d['description'][:90]}")


def cmd_reset(args) -> None:
    if input(f"DROP {FAST} and {DEEP} at {BASE}? type 'yes': ").strip() != "yes":
        return
    for coll in (FAST, DEEP):
        r = req("DELETE", f"/collections/{coll}")
        print(coll, r.status_code)


def main() -> int:
    if not ADMIN_KEY:
        print("TYPESENSE_ADMIN_KEY not set (see .env.example)", file=sys.stderr)
        return 2
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("setup").set_defaults(fn=cmd_setup)
    p = sub.add_parser("import"); p.add_argument("mode", choices=["fast", "deep"]); p.add_argument("--data", default="data")
    p.add_argument("--models", nargs="*"); p.set_defaults(fn=cmd_import)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    p = sub.add_parser("search"); p.add_argument("q"); p.add_argument("--mode", choices=["fast", "deep"], default="fast")
    p.add_argument("--model", default=None); p.set_defaults(fn=cmd_search)
    sub.add_parser("reset").set_defaults(fn=cmd_reset)
    args = ap.parse_args()
    args.fn(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
