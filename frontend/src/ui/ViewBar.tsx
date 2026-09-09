import { useState } from "react";
import { useStore } from "../store";

const SHORTCUTS: [string, string][] = [
  ["/", "search"],
  ["space", "swap drag between turn and move"],
  ["g", "globe or stack"],
  ["s", "sources"],
  ["f", "diagram only"],
  ["r", "reset the view"],
  ["click a layer", "fly to it and open it"],
  ["click a feature", "find its counterpart"],
];

/**
 * Viewport controls, kept together and out of the way: how the model is drawn,
 * how a drag behaves, and everything else folded behind a question mark so the
 * bottom of the screen is one line instead of a paragraph.
 *
 * Shape lives here rather than up with the search field: it changes how you look
 * at the model, not what you asked it. That leaves the top of the screen holding
 * one question and one choice, which is all a stranger needs to start.
 */
export function ViewBar() {
  const drag = useStore((s) => s.drag);
  const setDrag = useStore((s) => s.setDrag);
  const shape = useStore((s) => s.shape);
  const setShape = useStore((s) => s.setShape);
  const replayGuide = useStore((s) => s.replayGuide);
  const results = useStore((s) => s.results);
  const selected = useStore((s) => s.selected);
  const [open, setOpen] = useState(false);

  // the walkthrough annotates a resolved result; offering it over an empty
  // screen would point four notes at nothing
  const lit = selected.some((m) => (results[m]?.features.length ?? 0) > 0);

  return (
    <div className="viewbar">
      {open && (
        <div className="shortcuts">
          <span className="label">shortcuts</span>
          <dl>
            {SHORTCUTS.map(([key, what]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          {lit && (
            <button
              type="button"
              className="replay"
              onClick={() => {
                setOpen(false);
                replayGuide();
              }}
            >
              replay the walkthrough <span aria-hidden>→</span>
            </button>
          )}
        </div>
      )}
      <div className="viewbar-row">
        <span className="label">shape</span>
        <button type="button" className={shape === "stack" ? "on" : ""} onClick={() => setShape("stack")}>
          stack
        </button>
        <span className="sep">·</span>
        <button type="button" className={shape === "globe" ? "on" : ""} onClick={() => setShape("globe")}>
          globe
        </button>
        <span className="gap" />
        <span className="label">drag</span>
        <button type="button" className={drag === "orbit" ? "on" : ""} onClick={() => setDrag("orbit")}>
          turn
        </button>
        <span className="sep">·</span>
        <button type="button" className={drag === "pan" ? "on" : ""} onClick={() => setDrag("pan")}>
          move
        </button>
        <button
          type="button"
          className={`qmark${open ? " on" : ""}`}
          onClick={() => setOpen((v) => !v)}
          aria-label="keyboard shortcuts"
        >
          ?
        </button>
      </div>
    </div>
  );
}
