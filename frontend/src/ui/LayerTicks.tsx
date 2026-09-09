import { useStore } from "../store";

/**
 * The layer control is the tick column itself — the labels are the slider.
 * Hovering lights that layer in the 3D stack; clicking flies to it.
 */
export function LayerTicks() {
  const catalog = useStore((s) => s.catalog);
  const selected = useStore((s) => s.selected);
  const results = useStore((s) => s.results);
  const isolated = useStore((s) => s.isolated);
  const hoveredLayer = useStore((s) => s.hoveredLayer);
  const setHoveredLayer = useStore((s) => s.setHoveredLayer);
  const toggleIsolated = useStore((s) => s.toggleIsolated);

  if (!catalog || !selected.length) return null;
  const nLayers = Math.max(...selected.map((m) => catalog.models[m].nLayers));
  const primary = results[selected[0]];

  return (
    <nav className="ticks" aria-label="layers">
      <span className="label">layers</span>
      {Array.from({ length: nLayers }, (_, i) => nLayers - 1 - i).map((L) => {
        const hits = primary?.perLayer[L] ?? 0;
        const on = isolated === L || hoveredLayer === L;
        return (
          <button
            type="button"
            key={L}
            className={`tick${on ? " on" : ""}${hits ? " hit" : ""}`}
            onMouseEnter={() => setHoveredLayer(L)}
            onMouseLeave={() => setHoveredLayer(null)}
            onClick={() => toggleIsolated(L)}
          >
            <span className="tick-name">{L % 5 === 0 || on ? `L${L}` : ""}</span>
            <span className="tick-mark" />
            {hoveredLayer === L && isolated === null && (
              <span className="tick-count">{hits} matched</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
