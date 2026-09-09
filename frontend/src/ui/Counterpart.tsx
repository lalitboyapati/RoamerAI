import { useStore } from "../store";

/**
 * The picked feature and where its meaning lives in the other model. Found by
 * searching the other model's deep index with this feature's description, so
 * what crosses between models is meaning, never activations.
 */
export function CounterpartPanel() {
  const counterpart = useStore((s) => s.counterpart);
  const loading = useStore((s) => s.counterpartLoading);
  const catalog = useStore((s) => s.catalog);
  const clear = useStore((s) => s.clearCounterpart);
  const setHovered = useStore((s) => s.setHovered);
  const toggleSources = useStore((s) => s.toggleSources);

  if (loading) {
    return (
      <div className="counterpart">
        <span className="label">finding counterpart…</span>
      </div>
    );
  }
  if (!counterpart || !catalog) return null;

  const { source, target, features } = counterpart;
  const srcName = catalog.models[source.model].display;
  const dstName = catalog.models[target].display;
  const layers = features.map((f) => f.layer);
  const lo = layers.length ? Math.min(...layers) : null;
  const hi = layers.length ? Math.max(...layers) : null;
  const srcDepth = source.layer / (catalog.models[source.model].nLayers - 1);
  const shown = features.slice(0, 5);

  return (
    <aside className="counterpart">
      <header>
        <span className="label">counterpart</span>
        <button type="button" className="close" onClick={clear}>
          clear
        </button>
      </header>
      <p className="src">
        <span className="loc">
          {srcName} L{source.layer} · #{source.index}
        </span>
        {source.description}
      </p>
      <p className="arrow-line">
        {features.length === 0
          ? `nothing close in ${dstName}`
          : `${features.length} nearest in ${dstName} · layers ${lo}–${hi} · this feature sits ${Math.round(srcDepth * 100)}% deep in ${srcName}`}
      </p>
      <ul>
        {shown.map((f) => (
          <li key={f.id} onMouseEnter={() => setHovered(f.id)} onMouseLeave={() => setHovered(null)}>
            <span className="loc">
              L{f.layer} #{f.index}
            </span>
            {f.description}
          </li>
        ))}
        {features.length === 0 && <li className="none">try a feature with a more specific description</li>}
      </ul>
      {features.length > shown.length && (
        <button type="button" className="more" onClick={toggleSources}>
          {features.length - shown.length} more · open sources →
        </button>
      )}
    </aside>
  );
}
