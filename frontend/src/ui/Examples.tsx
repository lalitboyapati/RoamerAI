import { useStore } from "../store";
import type { Mode } from "../types";

/**
 * A running start, aimed at the person this is for: an engineer at a hospital
 * deciding whether a small model can be trusted with clinical text.
 *
 * Each example carries the mode that can actually find it. Fast mode requires
 * every word to match a feature description, so "discharge summary" only ever
 * lands in deep mode — which is the point of having both.
 */
const EXAMPLES: { q: string; mode: Mode }[] = [
  { q: "sepsis", mode: "deep" },
  { q: "medication dosage", mode: "deep" },
  { q: "discharge summary", mode: "deep" },
  { q: "radiology report", mode: "deep" },
  { q: "diagnosis", mode: "fast" },
  { q: "clinical", mode: "fast" },
];

export function Examples() {
  const askFor = useStore((s) => s.askFor);
  const q = useStore((s) => s.q);

  return (
    <div className="examples">
      <span className="label">try</span>
      {EXAMPLES.map((e) => (
        <button
          type="button"
          key={e.q}
          className={q === e.q ? "on" : ""}
          onClick={() => askFor(e.q, e.mode)}
        >
          {e.q}
        </button>
      ))}
    </div>
  );
}
