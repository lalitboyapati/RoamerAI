import { useStore } from "../store";

/**
 * Which models are on screen.
 *
 * A model that is already downloaded toggles instantly. One that is not says
 * what it weighs, because turning it on is a real download — this row is the
 * only place that cost is visible once the landing page is behind you.
 */
export function ModelBar() {
  const catalog = useStore((s) => s.catalog);
  const selected = useStore((s) => s.selected);
  const setSelected = useStore((s) => s.setSelected);
  if (!catalog) return null;

  const ids = Object.keys(catalog.models);
  const toggle = (id: string) => {
    const next = selected.includes(id)
      ? selected.filter((m) => m !== id)
      : [...ids.filter((m) => selected.includes(m) || m === id)];
    if (next.length) setSelected(next);
  };

  return (
    <div className="toggle">
      <span className="label">models</span>
      <span className="toggle-row">
        {ids.map((id, i) => {
          const on = selected.includes(id);
          const m = catalog.models[id];
          return (
            <span key={id}>
              {i > 0 && <span className="sep">·</span>}
              <button
                type="button"
                className={on ? "on" : ""}
                onClick={() => toggle(id)}
                title={on ? `hide ${m.display}` : `add ${m.display} · ${(m.bytes / 1e6).toFixed(0)} mb`}
              >
                {m.display}
              </button>
            </span>
          );
        })}
      </span>
    </div>
  );
}
