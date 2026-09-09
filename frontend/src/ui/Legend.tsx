import { useStore } from "../store";
import type { ModelId } from "../types";

/**
 * What the colours mean, for one model. Each lit feature is coloured by the
 * cluster its description embedding fell into, and named by the two words that
 * distinguish that cluster from the rest of the hits.
 *
 * This used to live in the bottom-left corner, where in Compare it grew to two
 * models' worth of rows and climbed straight through the tick column. The
 * colours describe one model's points, so they now sit in that model's own
 * block in the rail, next to its score and its verdict.
 */
export function Legend({ model }: { model: ModelId }) {
  const clusters = useStore((s) => s.results[model]?.clusters);

  if (!clusters?.length) return null;

  return (
    <div className="legend">
      <span className="label">concept clusters</span>
      <ul>
        {clusters.map((c) => (
          <li key={c.id}>
            <span className="swatch" style={{ background: c.colour }} />
            <span>{c.label}</span>
            <span className="count">{c.size}</span>
          </li>
        ))}
      </ul>
      <p className="note">position is a PCA of what the descriptions mean, not of the model's weights.</p>
    </div>
  );
}
