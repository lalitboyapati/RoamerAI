import { useEffect, useRef, useState } from "react";
import { smooth } from "../coverage";
import { useStore } from "../store";
import type { ModelId } from "../types";

/** Numbers tween to their new value rather than snapping (VISUAL-DIRECTION §4). */
function useTween(value: number, ms = 400): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);

  useEffect(() => {
    // rAF never fires in a hidden tab, and reduced-motion users opt out of the
    // tween entirely — in both cases show the real number rather than a stale one.
    const still =
      document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = performance.now();
    const a = from.current;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(Math.round(a + (value - a) * smooth(t)));
      if (t < 1) raf.current = requestAnimationFrame(step);
      else from.current = value;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, ms]);

  return shown;
}

export function Readout({ model, display }: { model: ModelId; display: string }) {
  const result = useStore((s) => s.results[model]);
  const manifest = useStore((s) => s.manifest);
  const score = useTween(result?.score ?? 0);
  const nLayers = manifest?.models[model].n_layers ?? 0;

  if (!result) return null;

  return (
    <div className="readout">
      <span className="label">{display}</span>
      <span className="score">{score}</span>
      <span className="label">coverage</span>
      <span className="stats">
        {result
          ? `${result.found.toLocaleString()} features · ${result.layersHit}/${nLayers} layers · ${result.ms} ms`
          : " "}
      </span>
    </div>
  );
}
