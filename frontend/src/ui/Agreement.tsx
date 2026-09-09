import { centroidAgreement, THIN } from "../search";
import { useStore } from "../store";
import type { ModelId } from "../types";

/**
 * Do these models mean the same thing by the concept?
 *
 * Cosine between each model's mean matched embedding. Concepts both models hold
 * well sit near 0.98; where one is thin they diverge, and the divergence is the
 * more interesting reading — it says the two models are responding to different
 * senses of the same word.
 */
export function Agreement({ models }: { models: ModelId[] }) {
  const results = useStore((s) => s.results);
  const catalog = useStore((s) => s.catalog);
  if (!catalog || models.length < 2) return null;

  const pairs: { a: ModelId; b: ModelId; v: number; thin: boolean }[] = [];
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const ra = results[models[i]];
      const rb = results[models[j]];
      const v = centroidAgreement(ra, rb);
      if (v !== null) {
        pairs.push({
          a: models[i],
          b: models[j],
          v,
          thin: (ra?.found ?? 0) < THIN || (rb?.found ?? 0) < THIN,
        });
      }
    }
  }
  if (!pairs.length) return null;

  const short = (m: ModelId) => catalog.models[m].display;

  return (
    <div className="agreement">
      <span className="label">do they mean the same thing</span>
      <ul>
        {pairs.map((p) => (
          <li key={p.a + p.b} className={p.thin ? "thin" : undefined}>
            <span className="ag-pair">
              {short(p.a)} <span className="ag-vs">·</span> {short(p.b)}
            </span>
            <span className="ag-rule">
              <span style={{ width: `${Math.max(0, Math.min(1, (p.v - 0.7) / 0.3)) * 100}%` }} />
            </span>
            <span className="ag-val">{p.v.toFixed(3)}</span>
          </li>
        ))}
      </ul>
      <p className="note">
        cosine between each model&rsquo;s mean matched feature. near 1 they agree; lower and they are
        answering different senses of the word.
      </p>
    </div>
  );
}
