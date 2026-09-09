import { modelsFor, useStore } from "../store";
import { LayerPlot } from "./LayerPlot";

/**
 * What is actually happening at the layer you selected: the block sequence, the
 * size of its feature space, and the descriptions that matched — each one a link
 * to the feature's page on Neuronpedia.
 */
export function LayerPanel() {
  const isolated = useStore((s) => s.isolated);
  const manifest = useStore((s) => s.manifest);
  const view = useStore((s) => s.view);
  const results = useStore((s) => s.results);
  const toggleIsolated = useStore((s) => s.toggleIsolated);
  const setHovered = useStore((s) => s.setHovered);
  const q = useStore((s) => s.q);
  const toggleSources = useStore((s) => s.toggleSources);

  if (isolated === null || !manifest) return null;
  const models = modelsFor(view);
  const searched = q.trim().length > 0;

  return (
    <aside className="layerpanel">
      <header>
        <span className="label">layer {isolated}</span>
        <button type="button" className="close" onClick={() => toggleIsolated(null)}>
          close
        </button>
      </header>

      <p className="flow">
        residual stream <span className="arrow">→</span> attention{" "}
        <span className="plus">+</span> <span className="arrow">→</span> mlp{" "}
        <span className="plus">+</span> <span className="arrow">→</span> residual stream
      </p>

      {models.map((m) => {
        const model = manifest.models[m];
        if (isolated >= model.n_layers) return null;
        const r = results[m];
        const matched = r?.perLayer[isolated] ?? 0;
        const here = (r?.features ?? []).filter((f) => f.layer === isolated);
        const shown = here.slice(0, 6);

        return (
          <div className="layer-model" key={m}>
            <p className="layer-stat">
              <span className="model-name">{model.display}</span>
              {model.width.toLocaleString()} features here ·{" "}
              {(model.deep.per_layer[String(isolated)] ?? 0).toLocaleString()} searched
              {searched && ` · ${matched.toLocaleString()} matched`}
            </p>
            <LayerPlot model={m} layer={isolated} />
            <ul>
              {shown.map((f) => (
                <li
                  key={f.id}
                  onMouseEnter={() => setHovered(f.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className="feat-idx">#{f.index}</span>
                  {f.description}
                </li>
              ))}
              {shown.length === 0 && (
                <li className="none">
                  {searched
                    ? "nothing in the searched sample of this layer matched"
                    : "search a concept to light these up"}
                </li>
              )}
            </ul>
            {here.length > shown.length && (
              <button type="button" className="more" onClick={toggleSources}>
                {here.length - shown.length} more · open sources →
              </button>
            )}
          </div>
        );
      })}
    </aside>
  );
}
