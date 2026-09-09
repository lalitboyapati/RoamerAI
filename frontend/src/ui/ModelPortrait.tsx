import { useMemo } from "react";
import type { CatalogModel } from "../types";

/**
 * A model, drawn.
 *
 * The picker used to offer three identical checkboxes for three quite
 * different networks. This gives each one its own portrait in the same
 * language the map uses: one hairline per layer, so 26 and 32 are a thing you
 * see rather than read, and a scatter of features across them.
 *
 * Deterministic from the model id, so a model always looks like itself.
 */
const W = 64;
const H = 92;
const TOP = 5;
const BOT = H - 5;

function rng(seed: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ModelPortrait({ id, model }: { id: string; model: CatalogModel }) {
  const { lines, dots } = useMemo(() => {
    const n = model.nLayers;
    const step = (BOT - TOP) / Math.max(1, n - 1);
    const ls = Array.from({ length: n }, (_, i) => TOP + i * step);
    const r = rng(id);
    const ds = Array.from({ length: 26 }, () => {
      const L = Math.floor(r() * n);
      return { x: 9 + r() * (W - 18), y: TOP + L * step, r: 0.7 + r() * 0.9 };
    });
    return { lines: ls, dots: ds };
  }, [id, model.nLayers]);

  return (
    <svg className="portrait" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      {/* the residual stream, the spine of the drawing */}
      <line x1={W / 2} y1={TOP - 3} x2={W / 2} y2={BOT + 3} className="pt-spine" />
      {lines.map((y, i) => (
        <line key={i} x1={7} y1={y} x2={W - 7} y2={y} className="pt-layer" />
      ))}
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} className="pt-dot" />
      ))}
    </svg>
  );
}
