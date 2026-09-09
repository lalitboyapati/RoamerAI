import { diagnose } from "../advice";
import { useStore } from "../store";
import type { ModelId } from "../types";

/**
 * The answer to the question people actually arrive with: can I ship this model
 * for my domain, and if not, where do I fine-tune it?
 */
export function Guidance({ model }: { model: ModelId }) {
  const result = useStore((s) => s.results[model]);
  const manifest = useStore((s) => s.manifest);
  const q = useStore((s) => s.q);
  const toggleIsolated = useStore((s) => s.toggleIsolated);
  const setHoveredLayer = useStore((s) => s.setHoveredLayer);

  if (!manifest || !result) return null;
  const d = diagnose(result, manifest.models[model], q);
  if (!d) return null;

  return (
    <section className="guidance">
      <p className={`verdict ${d.verdict}`}>{d.headline}</p>
      <p className="detail">{d.detail}</p>

      <div className="bands">
        {d.bands.map((b) => (
          <button
            type="button"
            key={b.key}
            className="band"
            onMouseEnter={() => setHoveredLayer(b.from)}
            onMouseLeave={() => setHoveredLayer(null)}
            onClick={() => toggleIsolated(b.from)}
          >
            <span className="band-label">{b.label} · L{b.from}–{b.to}</span>
            <span className="band-meter">
              <span style={{ width: `${Math.round(b.share * 100)}%` }} />
            </span>
            <span className="band-role">
              {b.role} · {Math.round(b.share * 100)}%
            </span>
          </button>
        ))}
      </div>

      <p className="action">{d.action}</p>
      {d.caveat && <p className="caveat">{d.caveat}</p>}

      {d.focus && (
        <button
          type="button"
          className="focus-link"
          onClick={() => toggleIsolated(d.focus![0])}
        >
          show {d.focus[0] === d.focus[1] ? `layer ${d.focus[0]}` : `layers ${d.focus[0]}–${d.focus[1]}`} →
        </button>
      )}
    </section>
  );
}
