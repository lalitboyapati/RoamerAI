import { useStore } from "../store";
import type { ModelId } from "../types";

/**
 * The per-layer distribution, straight from the `layer` facet — and also the
 * layer control: clicking a bar isolates that layer in the 3D stack.
 */
export function LayerBar({ model, nLayers }: { model: ModelId; nLayers: number }) {
  const result = useStore((s) => s.results[model]);
  const isolated = useStore((s) => s.isolated);
  const hoveredLayer = useStore((s) => s.hoveredLayer);
  const toggleIsolated = useStore((s) => s.toggleIsolated);
  const setHoveredLayer = useStore((s) => s.setHoveredLayer);

  if (!result || result.found === 0) return null;
  const peak = Math.max(1, ...Object.values(result.perLayer));

  return (
    <div className="layerbar">
      <div className="bars">
        {Array.from({ length: nLayers }, (_, L) => {
          const n = result.perLayer[L] ?? 0;
          return (
            <button
              type="button"
              key={L}
              className={isolated === L || hoveredLayer === L ? "bar on" : "bar"}
              style={{ height: `${Math.max(1, (n / peak) * 100)}%` }}
              title={`Layer ${L} · ${n} matched`}
              onMouseEnter={() => setHoveredLayer(L)}
              onMouseLeave={() => setHoveredLayer(null)}
              onClick={() => toggleIsolated(L)}
            />
          );
        })}
      </div>
      <div className="ends">
        <span>L0</span>
        <span>L{nLayers - 1}</span>
      </div>
    </div>
  );
}
