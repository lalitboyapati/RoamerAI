#!/usr/bin/env python3
"""
RomirAI — data pull
====================

Downloads SAE feature *explanations* (one short text description per feature)
from Neuronpedia's public dataset bucket and writes normalized JSONL that the
indexing script (index_typesense.py) consumes.

Sources (verified 2026-09-08):
  bucket   https://neuronpedia-datasets.s3.us-east-1.amazonaws.com/
  layout   v1/{modelId}/{sourceId}/explanations/batch-N.jsonl.gz
  gemma    modelId=gemma-2-2b   sourceId={L}-gemmascope-res-16k   L=0..25   16,384 feats/layer
  llama    modelId=llama3.1-8b  sourceId={L}-llamascope-res-32k   L=0..31   32,768 feats/layer

Each raw line is a Neuronpedia `Explanation` row:
  {"id":..., "modelId":"gemma-2-2b", "layer":"12-gemmascope-res-16k", "index":"4232",
   "description":"...", "explanationModelName":"gpt-4o-mini", "typeName":"oai_token-act-pair",
   "scoreV1":0, "scoreV2":null, ...}

Outputs (default --out data/):
  data/raw/{model}/{source}/batch-N.jsonl.gz   cached downloads (re-runs are free)
  data/{model}.fast.jsonl                      one doc per feature, ALL features
  data/{model}.deep.jsonl                      per-layer stride sample (default ~1k/layer)
  data/manifest.json                           counts per model / mode / layer (frontend needs this)

Usage:
  python scripts/pull_data.py                              # both models, all layers
  python scripts/pull_data.py --models gemma-2-2b          # one model
  python scripts/pull_data.py --layers 0-5 --max-batches 1 # smoke test (small, fast)
  python scripts/pull_data.py --dry-run                    # list what would be downloaded
  python scripts/pull_data.py --per-layer 2000             # bigger deep sample

Only dependency: requests  (pip install requests)
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import os
import random
import sys
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import requests

BUCKET = "https://neuronpedia-datasets.s3.us-east-1.amazonaws.com/"
S3_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"

MODELS: dict[str, "ModelSpec"] = {}


@dataclass(frozen=True)
class ModelSpec:
    model_id: str          # Neuronpedia model id
    source_set: str        # Neuronpedia source-set slug (after "{layer}-")
    n_layers: int
    width: int             # features per layer
    display: str

    def source(self, layer: int) -> str:
        return f"{layer}-{self.source_set}"

    def np_url(self, layer: int, index: int) -> str:
        return f"https://www.neuronpedia.org/{self.model_id}/{self.source(layer)}/{index}"


for spec in (
    ModelSpec("gemma-2-2b", "gemmascope-res-16k", 26, 16_384, "Gemma 2 2B"),
    ModelSpec("llama3.1-8b", "llamascope-res-32k", 32, 32_768, "Llama 3.1 8B"),
):
    MODELS[spec.model_id] = spec


# ----------------------------------------------------------------------------- S3 helpers
def s3_list(prefix: str, delimiter: str | None = None, session: requests.Session | None = None) -> tuple[list[str], list[str]]:
    """Anonymous ListObjectsV2. Returns (keys, common_prefixes). Follows continuation tokens."""
    sess = session or requests.Session()
    keys: list[str] = []
    prefixes: list[str] = []
    token: str | None = None
    while True:
        params = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
        if delimiter:
            params["delimiter"] = delimiter
        if token:
            params["continuation-token"] = token
        r = sess.get(BUCKET, params=params, timeout=60)
        r.raise_for_status()
        root = ET.fromstring(r.text)
        for c in root.findall(f"{S3_NS}Contents"):
            keys.append(c.find(f"{S3_NS}Key").text)
        for p in root.findall(f"{S3_NS}CommonPrefixes"):
            prefixes.append(p.find(f"{S3_NS}Prefix").text)
        truncated = (root.findtext(f"{S3_NS}IsTruncated") or "false").lower() == "true"
        token = root.findtext(f"{S3_NS}NextContinuationToken") if truncated else None
        if not token:
            break
    return keys, prefixes


def s3_download(key: str, dest: Path, session: requests.Session, retries: int = 4) -> Path:
    """Download one object to dest (skips if cached). Returns dest."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            with session.get(BUCKET + key, stream=True, timeout=120) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            tmp.replace(dest)
            return dest
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed to download {key}: {last_err}")


# ----------------------------------------------------------------------------- parsing
def parse_layer_num(layer_field: str) -> int:
    # "12-gemmascope-res-16k" -> 12
    return int(str(layer_field).split("-", 1)[0])


def iter_jsonl_gz(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def better(new: dict, old: dict) -> bool:
    """Pick which explanation becomes the primary description for a feature."""
    def score(e: dict) -> float:
        s2 = e.get("scoreV2")
        s1 = e.get("scoreV1")
        return float(s2 if s2 is not None else (s1 if s1 is not None else 0.0))
    return score(new) > score(old)


# ----------------------------------------------------------------------------- main pipeline
def layer_range(arg: str | None, n_layers: int) -> list[int]:
    if not arg:
        return list(range(n_layers))
    out: set[int] = set()
    for part in arg.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            out.update(range(int(a), int(b) + 1))
        else:
            out.add(int(part))
    return sorted(x for x in out if 0 <= x < n_layers)


def pull_model(spec: ModelSpec, layers: list[int], out_dir: Path, workers: int,
               max_batches: int | None, dry_run: bool) -> dict[int, list[Path]]:
    """Enumerate + download explanation batches for each layer. Returns {layer: [paths]}."""
    sess = requests.Session()
    prefix_root = f"v1/{spec.model_id}/"
    _, available = s3_list(prefix_root, delimiter="/", session=sess)
    available_sources = {p.rstrip("/").split("/")[-1] for p in available}

    jobs: list[tuple[int, str]] = []
    for L in layers:
        src = spec.source(L)
        if src not in available_sources:
            print(f"  ! {spec.model_id}: source {src} not in bucket, skipping", file=sys.stderr)
            continue
        keys, _ = s3_list(f"{prefix_root}{src}/explanations/", session=sess)
        keys = sorted(k for k in keys if k.endswith(".jsonl.gz"))
        if max_batches:
            keys = keys[:max_batches]
        if not keys:
            print(f"  ! {spec.model_id}: no explanation batches for {src}", file=sys.stderr)
        for k in keys:
            jobs.append((L, k))

    print(f"  {spec.model_id}: {len(jobs)} batch files across {len(layers)} layers")
    if dry_run:
        for L, k in jobs[:10]:
            print(f"    {k}")
        if len(jobs) > 10:
            print(f"    ... (+{len(jobs) - 10} more)")
        return {}

    result: dict[int, list[Path]] = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {}
        for L, k in jobs:
            dest = out_dir / "raw" / spec.model_id / spec.source(L) / Path(k).name
            futs[ex.submit(s3_download, k, dest, sess)] = (L, k)
        done = 0
        for fut in as_completed(futs):
            L, k = futs[fut]
            path = fut.result()
            result.setdefault(L, []).append(path)
            done += 1
            if done % 10 == 0 or done == len(futs):
                print(f"    downloaded {done}/{len(futs)}", flush=True)
    return result


def normalize_model(spec: ModelSpec, batches: dict[int, list[Path]], out_dir: Path,
                    per_layer: int, sample_mode: str, seed: int) -> dict:
    """Merge explanations -> one doc per feature. Write fast + deep JSONL. Return manifest entry."""
    fast_path = out_dir / f"{spec.model_id}.fast.jsonl"
    deep_path = out_dir / f"{spec.model_id}.deep.jsonl"
    rng = random.Random(seed)
    manifest = {"display": spec.display, "source_set": spec.source_set, "n_layers": spec.n_layers,
                "width": spec.width, "fast": {"total": 0, "per_layer": {}},
                "deep": {"total": 0, "per_layer": {}, "per_layer_target": per_layer, "sample_mode": sample_mode}}

    stride = max(1, spec.width // per_layer)
    with open(fast_path, "w", encoding="utf-8") as ffast, open(deep_path, "w", encoding="utf-8") as fdeep:
        for L in sorted(batches):
            feats: dict[int, dict] = {}
            for p in sorted(batches[L]):
                for row in iter_jsonl_gz(p):
                    desc = (row.get("description") or "").strip()
                    if not desc:
                        continue
                    try:
                        idx = int(row["index"])
                    except (KeyError, ValueError):
                        continue
                    cur = feats.get(idx)
                    if cur is None:
                        feats[idx] = {"primary": row, "all": [desc]}
                    else:
                        if desc not in cur["all"]:
                            cur["all"].append(desc)
                        if better(row, cur["primary"]):
                            cur["primary"] = row

            # deep sample selection
            if sample_mode == "random":
                pool = sorted(feats)
                chosen = set(rng.sample(pool, min(per_layer, len(pool))))
            else:  # stride: deterministic, spread evenly across index space
                chosen = {i for i in feats if i % stride == 0}

            n_fast = n_deep = 0
            for idx in sorted(feats):
                prim = feats[idx]["primary"]
                desc = (prim.get("description") or "").strip()
                doc = {
                    "id": f"{spec.model_id}_{L}_{idx}",
                    "model": spec.model_id,
                    "layer": L,
                    "index": idx,
                    "description": desc,
                    "descriptions": feats[idx]["all"],
                    "explainer": prim.get("explanationModelName") or "unknown",
                    "source": spec.source(L),
                    "np_url": spec.np_url(L, idx),
                }
                line = json.dumps(doc, ensure_ascii=False) + "\n"
                ffast.write(line)
                n_fast += 1
                if idx in chosen:
                    fdeep.write(line)
                    n_deep += 1
            manifest["fast"]["per_layer"][str(L)] = n_fast
            manifest["deep"]["per_layer"][str(L)] = n_deep
            manifest["fast"]["total"] += n_fast
            manifest["deep"]["total"] += n_deep
            print(f"    layer {L:>2}: {n_fast:>6} features, {n_deep:>5} in deep sample", flush=True)

    print(f"  wrote {fast_path} ({manifest['fast']['total']} docs) and {deep_path} ({manifest['deep']['total']} docs)")
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", nargs="+", default=list(MODELS), choices=list(MODELS))
    ap.add_argument("--layers", default=None, help="e.g. '0-5' or '0,12,25' (default: all)")
    ap.add_argument("--out", default="data", help="output directory")
    ap.add_argument("--per-layer", type=int, default=1000, help="deep-mode sample size per layer")
    ap.add_argument("--sample-mode", choices=["stride", "random"], default="stride")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--max-batches", type=int, default=None, help="cap batch files per layer (smoke tests)")
    ap.add_argument("--dry-run", action="store_true", help="list, don't download")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"models": {}}

    t0 = time.time()
    for mid in args.models:
        spec = MODELS[mid]
        layers = layer_range(args.layers, spec.n_layers)
        print(f"\n== {spec.display} ({mid}) layers {layers[0]}..{layers[-1]}")
        batches = pull_model(spec, layers, out_dir, args.workers, args.max_batches, args.dry_run)
        if args.dry_run:
            continue
        manifest["models"][mid] = normalize_model(spec, batches, out_dir, args.per_layer, args.sample_mode, args.seed)
        manifest["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        manifest_path.write_text(json.dumps(manifest, indent=2))
        print(f"  manifest -> {manifest_path}")

    print(f"\ndone in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
