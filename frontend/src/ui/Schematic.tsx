import { useStore } from "../store";
import { C } from "../palette";

/**
 * The explanatory inset: one transformer layer, expanded. It's the legend for
 * the 3D stack — same shapes, same lines, so the rings out there read as blocks.
 * Lens = attention, square = MLP, the vertical line through them is the
 * residual stream, and the ring of dots is that layer's feature space.
 */
export function Schematic() {
  const catalog = useStore((s) => s.catalog);
  const selected = useStore((s) => s.selected);
  const isolated = useStore((s) => s.isolated);
  const results = useStore((s) => s.results);

  // the legend takes this corner as soon as there is something to explain
  const lit = selected.some((m) => (results[m]?.features.length ?? 0) > 0);
  if (lit) return null;

  const nLayers = catalog?.models[selected[0]]?.nLayers ?? 26;
  const stroke = C.STRUCTURE;

  return (
    <figure className="schematic">
      <svg viewBox="-14 0 218 134" width="218" height="134" aria-hidden>
        {/* residual stream */}
        <line x1="95" y1="4" x2="95" y2="128" stroke={stroke} strokeWidth="1" opacity="0.55" />

        {/* attention detour */}
        <path d="M95 96 H55 V70 H95" fill="none" stroke={stroke} strokeWidth="1" opacity="0.45" />
        <path d="M55 74 L61 83 L55 92 L49 83 Z" fill="none" stroke={stroke} strokeWidth="1" opacity="0.9" />
        <text x="42" y="86" className="s-label" textAnchor="end">attention</text>

        {/* MLP detour */}
        <path d="M95 58 H135 V32 H95" fill="none" stroke={stroke} strokeWidth="1" opacity="0.45" />
        <rect x="127" y="37" width="16" height="16" fill="none" stroke={stroke} strokeWidth="1" opacity="0.9" />
        <text x="150" y="48" className="s-label">mlp</text>

        {/* residual junctions */}
        {[70, 32].map((y) => (
          <g key={y} stroke={stroke} strokeWidth="1" opacity="0.95">
            <line x1="91" y1={y} x2="99" y2={y} />
            <line x1="95" y1={y - 4} x2="95" y2={y + 4} />
          </g>
        ))}

        {/* the layer's feature space, matching the annulus in the scene */}
        <ellipse cx="95" cy="112" rx="40" ry="9" fill="none" stroke={stroke} strokeWidth="1" opacity="0.4" />
        {[-36, -30, -24, 24, 30, 36].map((dx, i) => (
          <circle key={dx} cx={95 + dx} cy={112 + (i % 2 ? 3 : -3)} r="1.4"
            fill={i === 2 ? C.BLUE : C.SCAFFOLD} />
        ))}
        <text x="95" y="128" className="s-label" textAnchor="middle">features live here</text>

        <text x="95" y="12" className="s-label" textAnchor="middle">
          one layer · ×{nLayers}
        </text>
      </svg>
      <figcaption>
        {isolated !== null
          ? `layer ${isolated} isolated — click again to release`
          : "each ring in the stack is one of these"}
      </figcaption>
    </figure>
  );
}
