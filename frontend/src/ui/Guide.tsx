import { useEffect } from "react";
import { GUIDE_ANCHORS, GUIDE_STEPS, useStore } from "../store";

/**
 * The first search, annotated. Four notes appear one at a time in the same place,
 * and the thing each one is about turns yellow while it shows — which is what
 * yellow already means here: the one thing being pointed at, right now
 * (VISUAL-DIRECTION §1). The highlight is the attachment, so the note never has
 * to sit on top of the model to claim it. Runs once per browser.
 */
const STEPS: { title: string; body: string }[] = [
  {
    title: "what lit up",
    body: "Each bright point is one feature — a single pattern this model learned, carrying a plain-English description of what makes it fire. The faint ones are the rest of that layer, unmatched. A feature's position never changes, so it is always in the same place.",
  },
  {
    title: "the number",
    body: "How many descriptions responded, normalised by index size and weighted by how far they spread across the layers. It is a heuristic with no evaluation behind it — read it as a rough altitude, not a benchmark.",
  },
  {
    title: "where it sits",
    body: "Where the hits land matters more than how many there are. Early layers carry surface form, middle layers carry meaning, late layers shape the answer — so a thin middle band is the fine-tuning signal.",
  },
  {
    title: "the evidence",
    body: "Click any layer — a tick in the column on the left, a bar in this rail, or a ring in the map — to read the descriptions that actually matched inside it. Every one links back to the page it came from.",
  },
];

export function Guide() {
  const step = useStore((s) => s.guideStep);
  const next = useStore((s) => s.nextGuide);
  const end = useStore((s) => s.endGuide);
  // The layer panel and the counterpart share this column. A note that is
  // waiting to be read yields to the thing the visitor just opened, and comes
  // back where it left off when they close it.
  const covered = useStore(
    (s) => s.isolated !== null || s.counterpart !== null || s.counterpartLoading
  );

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        end();
      }
      if (e.key === "Enter" || e.key === "ArrowRight") {
        // Enter belongs to the search field while it has focus
        if (document.activeElement instanceof HTMLInputElement) return;
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, next, end]);

  if (step === null || covered) return null;
  const s = STEPS[step];
  const last = step === GUIDE_STEPS - 1;

  return (
    <aside className={`guide guide-${GUIDE_ANCHORS[step]}`} aria-live="polite">
      <p className="guide-title">{s.title}</p>
      <p className="guide-body">{s.body}</p>
      <div className="guide-foot">
        <button type="button" className="guide-next" onClick={next}>
          {last ? "start looking" : "next"} <span aria-hidden>→</span>
        </button>
        {!last && (
          <button type="button" className="guide-skip" onClick={end}>
            skip
          </button>
        )}
        <span className="guide-count">
          {step + 1}/{GUIDE_STEPS}
        </span>
      </div>
    </aside>
  );
}
