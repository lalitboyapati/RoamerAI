import { useStore } from "../store";
import { C } from "../palette";
import type { ModelId } from "../types";

const LINE = [C.BLUE, C.RED, C.GREEN, C.GOLD];

/**
 * Where each model holds the concept, on one axis.
 *
 * Layer index is not comparable between a 26-layer model and a 32-layer one, so
 * both are plotted against relative depth. This is the only view in which the
 * two distributions can honestly be laid over each other.
 */
export function DepthProfile({ models }: { models: ModelId[] }) {
  const results = useStore((s) => s.results);
  const catalog = useStore((s) => s.catalog);
  const setHoveredLayer = useStore((s) => s.setHoveredLayer);
  if (!catalog) return null;

  const series = models
    .map((m, i) => ({ m, r: results[m], colour: LINE[i % LINE.length] }))
    .filter((s) => s.r && s.r.found > 0);
  if (series.length < 1) return null;

  const W = 300;
  const H = 74;
  const peak = Math.max(...series.flatMap((s) => s.r!.profile.map((p) => p.share)), 0.001);

  // a light 3-point smoothing: layer counts are spiky and the shape is the point
  const path = (pts: { at: number; share: number }[]) => {
    const y = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)].share;
      const b = pts[Math.min(pts.length - 1, i + 1)].share;
      return (a + p.share * 2 + b) / 4;
    });
    return pts
      .map((p, i) => `${i ? "L" : "M"}${(p.at * W).toFixed(1)} ${(H - (y[i] / peak) * H).toFixed(1)}`)
      .join(" ");
  };

  return (
    <figure className="depthprofile">
      <span className="label">where it sits</span>
      <svg viewBox={`0 -4 ${W} ${H + 18}`} width="100%" preserveAspectRatio="none" aria-hidden>
        {/* the concept band, marked once rather than labelled three times */}
        <rect x={W / 3} y={-4} width={W / 3} height={H + 4} fill={C.SCAFFOLD} opacity="0.35" />
        <line x1="0" y1={H} x2={W} y2={H} stroke={C.STRUCTURE} strokeWidth="1" />
        {series.map((s) => (
          <path key={s.m} d={path(s.r!.profile)} fill="none" stroke={s.colour} strokeWidth="1.25" opacity="0.95" />
        ))}
        {/* pointer band for reading a depth off the curve */}
        {Array.from({ length: 12 }, (_, i) => (
          <rect
            key={i}
            x={(i * W) / 12}
            y={-4}
            width={W / 12}
            height={H + 4}
            fill="transparent"
            style={{ pointerEvents: "all" }}
            onMouseEnter={() => {
              const first = series[0];
              const n = catalog.models[first.m].nLayers;
              setHoveredLayer(Math.round(((i + 0.5) / 12) * (n - 1)));
            }}
            onMouseLeave={() => setHoveredLayer(null)}
          />
        ))}
      </svg>
      <figcaption>
        <span>input</span>
        <span className="dp-band">concepts</span>
        <span>output</span>
      </figcaption>
      <ul className="dp-key">
        {series.map((s) => (
          <li key={s.m}>
            <span className="dp-swatch" style={{ background: s.colour }} />
            {catalog.models[s.m].display}
            <span className="dp-depth">{Math.round(s.r!.depth * 100)}% deep</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
