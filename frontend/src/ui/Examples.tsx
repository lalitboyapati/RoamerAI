import { useStore } from "../store";

/**
 * A running start. Six fields rather than six clinical phrases: the person who
 * lands here arrives with a concept from their own domain, and an all-medical
 * list reads as an all-medical tool.
 *
 * Every one of these returns hits against the indexed descriptions, and they are
 * not all flattering — "kubernetes" and "protein folding" come back thin on
 * purpose, because a verdict nobody can fail means nothing.
 */
const EXAMPLES = [
  "sepsis",
  "contract law",
  "gene expression",
  "monetary policy",
  "unit tests",
  "kubernetes",
];

export function Examples() {
  const askFor = useStore((s) => s.askFor);
  const q = useStore((s) => s.q);

  return (
    <div className="examples">
      <span className="label">try</span>
      {EXAMPLES.map((e) => (
        <button type="button" key={e} className={q === e ? "on" : ""} onClick={() => askFor(e)}>
          {e}
        </button>
      ))}
    </div>
  );
}
