import { useMemo, useState } from "react";
import { useStore } from "../store";
import { CLUSTER_COLOURS } from "../geometry";
import { go } from "../route";
import type { ModelId } from "../types";

/**
 * Every layer of one model, side by side.
 *
 * The 3D stack shows one layer at a time and the shape of the whole thing at
 * once; this shows the opposite — the semantic arrangement inside every layer,
 * as small multiples on a common scale. Read down the grid and you watch a
 * concept assemble: scattered near the input, clustered through the middle,
 * fanning out again as the model turns meaning into output.
 */
const CELL = 96;
const PAD = 7;

function Cell({ model, layer, maxR }: { model: ModelId; layer: number; maxR: number }) {
  const results = useStore((s) => s.results);
  const toggleIsolated = useStore((s) => s.toggleIsolated);
  const isolated = useStore((s) => s.isolated);

  const pts = useMemo(() => {
    const feats = (results[model]?.features ?? []).filter((f) => f.layer === layer && f.pca);
    const half = (CELL - PAD * 2) / 2;
    return feats.map((f) => ({
      id: f.id,
      cx: PAD + half + (f.pca![0] / maxR) * half,
      // svg y grows downward; flip so PC2 points up like a normal plot
      cy: PAD + half - (f.pca![1] / maxR) * half,
      r: 1.3 + 1.8 * f.rel,
      colour: f.cluster !== undefined ? CLUSTER_COLOURS[f.cluster] : "#58C4DD",
    }));
  }, [results, model, layer, maxR]);

  const n = results[model]?.perLayer[layer] ?? 0;
  const c = PAD + (CELL - PAD * 2) / 2;

  return (
    <li className={isolated === layer ? "on" : undefined}>
      <button type="button" onClick={() => toggleIsolated(layer)} title={`layer ${layer} · ${n} matched`}>
        <svg viewBox={`0 0 ${CELL} ${CELL}`} width={CELL} height={CELL} aria-hidden>
          <circle cx={c} cy={c} r={(CELL - PAD * 2) / 2} className="lg-frame" />
          <line x1={PAD} y1={c} x2={CELL - PAD} y2={c} className="lg-axis" />
          <line x1={c} y1={PAD} x2={c} y2={CELL - PAD} className="lg-axis" />
          {pts.map((p) => (
            <circle key={p.id} cx={p.cx} cy={p.cy} r={p.r} fill={p.colour} opacity="0.9" />
          ))}
        </svg>
        <span className="lg-label">
          L{layer}
          <span className="lg-count">{n}</span>
        </span>
      </button>
    </li>
  );
}

export function LayerGrid() {
  const catalog = useStore((s) => s.catalog);
  const selected = useStore((s) => s.selected);
  const results = useStore((s) => s.results);
  const q = useStore((s) => s.q);
  const setQuery = useStore((s) => s.setQuery);
  const [model, setModel] = useState<ModelId | null>(null);

  if (!catalog) return <div className="profile"><p className="landing-loading">reading the catalogue…</p></div>;
  const shown = model && selected.includes(model) ? model : selected[0];
  const spec = shown ? catalog.models[shown] : null;
  const r = shown ? results[shown] : undefined;
  // One radius for the whole grid. Normalising each disc to its own maximum
  // would make every layer look equally dispersed, which is the opposite of
  // what the grid is for — and would make the caption below a lie.
  const maxR = Math.max(
    1e-6,
    ...(results[shown!]?.features ?? []).filter((f) => f.pca).map((f) => Math.hypot(f.pca![0], f.pca![1]))
  );

  return (
    <div className="profile layergrid">
      <header>
        <span className="wordmark">ROMIRAI</span>
        <span className="tagline">every layer, flattened</span>
        <button type="button" className="focus-btn" onClick={() => go("atlas")}>
          the map →
        </button>
        <button type="button" className="focus-btn" onClick={() => go("profile")}>
          profile
        </button>
      </header>

      <div className="lg-controls">
        <label className="field">
          <span className="label">concept</span>
          <input value={q} onChange={(e) => setQuery(e.target.value)} placeholder="sepsis" spellCheck={false} />
        </label>
        <div className="toggle">
          <span className="label">model</span>
          <span className="toggle-row">
            {selected.map((m, i) => (
              <span key={m}>
                {i > 0 && <span className="sep">·</span>}
                <button type="button" className={m === shown ? "on" : ""} onClick={() => setModel(m)}>
                  {catalog.models[m].display}
                </button>
              </span>
            ))}
          </span>
        </div>
      </div>

      {!r || !r.found ? (
        <p className="msg">search a concept to see how it arranges itself inside each layer.</p>
      ) : (
        <>
          <p className="lg-lede">
            {spec!.display} · {r.found.toLocaleString()} features respond to “{q.trim()}”, across{" "}
            {r.layersHit} of {spec!.nLayers} layers. Each disc is one layer&rsquo;s matched features,
            placed by the first two principal components of what their descriptions mean. The centre
            is the average matched concept; colour is the cluster. Click a layer to open it on the
            map.
          </p>
          <ol className="lg-grid">
            {Array.from({ length: spec!.nLayers }, (_, L) => (
              <Cell key={L} model={shown!} layer={L} maxR={maxR} />
            ))}
          </ol>
          <p className="matrix-note">
            the projection is fitted once per model and reused for every layer, so a point on the
            left means the same thing in layer 3 and layer 20. it is a projection of the
            descriptions&rsquo; meanings, not of the model&rsquo;s weights.
          </p>
        </>
      )}
    </div>
  );
}
