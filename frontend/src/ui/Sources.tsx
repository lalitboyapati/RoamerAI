import { useStore } from "../store";
import { CLUSTER_COLOURS } from "../geometry";
import type { Feature, ModelId } from "../types";

/**
 * Provenance, kept out of the way until asked for. Every feature on screen is a
 * real row on Neuronpedia; this is the one place those links live, so the map
 * and the layer panel can stay unmarked.
 */
function Row({ f }: { f: Feature }) {
  const setHovered = useStore((s) => s.setHovered);
  return (
    <li onMouseEnter={() => setHovered(f.id)} onMouseLeave={() => setHovered(null)}>
      <a href={f.npUrl} target="_blank" rel="noreferrer">
        <span className="src-loc">
          L{f.layer}
          <span className="src-idx">#{f.index}</span>
        </span>
        <span className="src-desc">{f.description}</span>
        {f.cluster !== undefined && (
          <span className="src-swatch" style={{ background: CLUSTER_COLOURS[f.cluster] }} />
        )}
      </a>
    </li>
  );
}

function byLayerThenRelevance(a: Feature, b: Feature) {
  return a.layer - b.layer || b.rel - a.rel;
}

export function Sources() {
  const open = useStore((s) => s.sourcesOpen);
  const toggle = useStore((s) => s.toggleSources);
  const results = useStore((s) => s.results);
  const selected = useStore((s) => s.selected);
  const catalog = useStore((s) => s.catalog);
  const isolated = useStore((s) => s.isolated);
  const counterpart = useStore((s) => s.counterpart);

  if (!open || !catalog) return null;

  const models = selected;
  const section = (m: ModelId) => {
    const all = results[m]?.features ?? [];
    const rows = (isolated === null ? all : all.filter((f) => f.layer === isolated)).slice().sort(byLayerThenRelevance);
    return { model: m, rows };
  };
  const sections = models.map(section).filter((s) => s.rows.length > 0);
  const cpRows = counterpart ? counterpart.features.slice().sort(byLayerThenRelevance) : [];
  const total = sections.reduce((n, s) => n + s.rows.length, 0) + cpRows.length;

  return (
    <aside className="sources">
      <header>
        <span className="label">sources</span>
        <span className="src-count">
          {total} feature{total === 1 ? "" : "s"}
          {isolated !== null && ` · layer ${isolated}`}
        </span>
        <button type="button" className="close" onClick={toggle}>
          close
        </button>
      </header>

      <p className="src-note">
        every row is a real feature on Neuronpedia, with the text that made it fire. opens in a new tab.
      </p>

      {sections.map((s) => (
        <section key={s.model}>
          <p className="src-model">{catalog.models[s.model].display}</p>
          <ul>
            {s.rows.map((f) => (
              <Row key={f.id} f={f} />
            ))}
          </ul>
        </section>
      ))}

      {cpRows.length > 0 && counterpart && (
        <section>
          <p className="src-model gold">counterparts in {catalog.models[counterpart.target].display}</p>
          <ul>
            {cpRows.map((f) => (
              <Row key={f.id} f={f} />
            ))}
          </ul>
        </section>
      )}

      {total === 0 && <p className="src-note">search something first.</p>}
    </aside>
  );
}
