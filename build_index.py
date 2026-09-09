#!/usr/bin/env python3
"""
RomirAI — static search index.

Pulls every deep-collection document out of Typesense with its embedding and
writes a self-contained index the browser can search on its own. The corpus is
59k short strings that never change; renting an always-on search node to serve
it costs money forever and buys nothing, so the deployed site ships the index
as static files instead.

Outputs into frontend/public/idx/:
  meta.json   dimensions, quantisation scale, per-model offsets, PCA basis info
  docs.json   [layer, index, description] per model, in index order
  vecs.i8     int8 matrix, one row per document, same order as docs
  pca.f32     mean + components, so the browser can project a query into the
              same reduced space (absent when --dims is the full 384)

np_url is not stored: it is exactly
  https://www.neuronpedia.org/{model}/{layer}-{source_set}/{index}
and source_set is already in manifest.json.

Usage:  python3 build_index.py [--dims 192] [--host localhost] [--port 8108]
"""
import argparse, json, math, os, sys, urllib.request

MODELS = ["gemma-2-2b", "llama3.1-8b"]
OUT = os.path.join("frontend", "public", "idx")


def export(host, port, key, collection):
    url = "http://%s:%d/collections/%s/documents/export?include_fields=model,layer,index,description,embedding" % (
        host, port, collection)
    req = urllib.request.Request(url, headers={"X-TYPESENSE-API-KEY": key})
    with urllib.request.urlopen(req) as r:
        for line in r:
            line = line.strip()
            if line:
                yield json.loads(line)


def main():
    import numpy as np

    ap = argparse.ArgumentParser()
    ap.add_argument("--dims", type=int, default=192, help="reduced dimensions (384 = no reduction)")
    ap.add_argument("--host", default=os.environ.get("TYPESENSE_HOST", "localhost"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("TYPESENSE_PORT", 8108)))
    ap.add_argument("--key", default=os.environ.get("TYPESENSE_ADMIN_KEY", "roamerai-dev-admin"))
    args = ap.parse_args()

    print("exporting features_deep from %s:%d ..." % (args.host, args.port))
    rows = {m: [] for m in MODELS}
    vecs = {m: [] for m in MODELS}
    n = 0
    for d in export(args.host, args.port, args.key, "features_deep"):
        m = d["model"]
        if m not in rows:
            continue
        e = d.get("embedding")
        if not e:
            continue
        rows[m].append((int(d["layer"]), int(d["index"]), d["description"]))
        vecs[m].append(e)
        n += 1
        if n % 10000 == 0:
            print("  %d ..." % n)
    print("exported %d documents" % n)

    # Deterministic order: the browser reads docs and vectors by the same row.
    docs = {}
    mats = []
    offsets = {}
    cursor = 0
    for m in MODELS:
        order = sorted(range(len(rows[m])), key=lambda i: (rows[m][i][0], rows[m][i][1]))
        docs[m] = [list(rows[m][i]) for i in order]
        mats.append(np.asarray([vecs[m][i] for i in order], dtype=np.float32))
        offsets[m] = {"offset": cursor, "count": len(order)}
        cursor += len(order)
    X = np.concatenate(mats, axis=0)
    del mats, vecs, rows
    print("matrix %s" % (X.shape,))

    # Typesense stores mean-pooled vectors unnormalised; cosine needs unit norm.
    X /= np.linalg.norm(X, axis=1, keepdims=True).clip(1e-9)

    mean = X.mean(axis=0).astype(np.float32)
    pca = None
    if args.dims < X.shape[1]:
        C = X - mean
        # economy SVD on 59k x 384 is a few seconds and exact
        _, S, Vt = np.linalg.svd(C, full_matrices=False)
        comp = Vt[: args.dims].astype(np.float32)
        var = float((S[: args.dims] ** 2).sum() / (S ** 2).sum())
        print("PCA %d dims, %.1f%% of variance retained" % (args.dims, var * 100))
        R = C @ comp.T
        R /= np.linalg.norm(R, axis=1, keepdims=True).clip(1e-9)
        pca = (mean, comp)
        Y = R
    else:
        Y = X

    scale = float(np.abs(Y).max()) / 127.0
    Q = np.clip(np.rint(Y / scale), -127, 127).astype(np.int8)

    # How much the quantised, reduced index disagrees with the exact one.
    rng = np.random.default_rng(0)
    probe = rng.choice(X.shape[0], size=200, replace=False)
    exact = X @ X[probe].T
    approx = (Q.astype(np.float32) * scale) @ (Q[probe].astype(np.float32) * scale).T
    keep = 0
    for j in range(len(probe)):
        a = set(np.argsort(-exact[:, j])[:50])
        b = set(np.argsort(-approx[:, j])[:50])
        keep += len(a & b)
    print("recall@50 vs exact float search: %.3f" % (keep / (50.0 * len(probe))))

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "docs.json"), "w") as f:
        json.dump(docs, f, separators=(",", ":"), ensure_ascii=False)
    Q.tofile(os.path.join(OUT, "vecs.i8"))
    if pca is not None:
        with open(os.path.join(OUT, "pca.f32"), "wb") as f:
            f.write(pca[0].tobytes())
            f.write(pca[1].tobytes())
    meta = {
        "version": 1,
        "embedModel": "Xenova/all-MiniLM-L12-v2",
        "sourceDims": int(X.shape[1]),
        "dims": int(Q.shape[1]),
        "scale": scale,
        "count": int(Q.shape[0]),
        "pca": pca is not None,
        "models": offsets,
    }
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    for name in ["meta.json", "docs.json", "vecs.i8", "pca.f32"]:
        p = os.path.join(OUT, name)
        if os.path.exists(p):
            print("  %-10s %7.2f MB" % (name, os.path.getsize(p) / 1e6))


if __name__ == "__main__":
    main()
