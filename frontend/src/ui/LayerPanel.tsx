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

  if (isolated === null || !manifest) return null;
  const models = modelsFor(view);

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
        const shown = (r?.features ?? []).filter((f) => f.layer === isolated).slice(0, 8);

        return (
          <div className="layer-model" key={m}>
            <p className="layer-stat">
              <span className="model-name">{model.display}</span>
              {model.width.toLocaleString()} features here · {matched.toLocaleString()} matched
            </p>
            <LayerPlot model={m} layer={isolated} />
            <ul>
              {shown.map((f) => (
                <li
                  key={f.id}
                  onMouseEnter={() => setHovered(f.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <a href={f.npUrl} target="_blank" rel="noreferrer">
                    <span className="feat-idx">#{f.index}</span>
                    {f.description}
                  </a>
                </li>
              ))}
              {shown.length === 0 && <li className="none">nothing matched in this layer</li>}
            </ul>
          </div>
        );
      })}
    </aside>
  );
}
