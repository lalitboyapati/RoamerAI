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
 * Viewport controls, kept together and out of the way: how a drag behaves, and
 * everything else folded behind a question mark so the bottom of the screen is
 * one line instead of a paragraph.
 */
export function ViewBar() {
  const drag = useStore((s) => s.drag);
  const setDrag = useStore((s) => s.setDrag);
  const [open, setOpen] = useState(false);

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
        </div>
      )}
      <div className="viewbar-row">
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
