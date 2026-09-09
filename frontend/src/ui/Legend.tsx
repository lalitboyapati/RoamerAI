import { modelsFor, useStore } from "../store";

/**
 * What the colours mean. Deep mode only: each lit feature is coloured by the
 * cluster its description embedding fell into, and named by the two words
 * that distinguish that cluster from the rest of the hits.
 */
export function Legend() {
  const mode = useStore((s) => s.mode);
  const view = useStore((s) => s.view);
  const results = useStore((s) => s.results);
  const manifest = useStore((s) => s.manifest);

  if (mode !== "deep" || !manifest) return null;
  const models = modelsFor(view).filter((m) => (results[m]?.clusters.length ?? 0) > 0);
  if (!models.length) return null;

  return (
    <div className="legend">
      <span className="label">concept clusters</span>
      {models.map((m) => (
        <div key={m}>
          {models.length > 1 && <p className="note">{manifest.models[m].display}</p>}
          <ul>
            {results[m]!.clusters.map((c) => (
              <li key={c.id}>
                <span className="swatch" style={{ background: c.colour }} />
                <span>{c.label}</span>
                <span className="count">{c.size}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="note">position is a PCA of what the descriptions mean, not of the model's weights.</p>
    </div>
  );
}
