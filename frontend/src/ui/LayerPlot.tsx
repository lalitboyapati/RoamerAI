import { useMemo } from "react";
import { useStore } from "../store";
import { CLUSTER_COLOURS } from "../geometry";
import type { ModelId } from "../types";

const SIZE = 208;
const PAD = 10;

/**
 * The layer's semantic disc, flattened. Every feature that matched in this
 * layer, placed by the first two principal components of its description
 * embedding — the same projection that positions it in 3D, so a dot on the
 * left here is the dot on the left of the ring out there.
 *
 * The origin is the average matched concept, which is why it is drawn: distance
 * from the cross is how far a feature's meaning sits from the middle of what
 * the query found. One scale on both axes, so angles are true.
 */
export function LayerPlot({ model, layer }: { model: ModelId; layer: number }) {
  const results = useStore((s) => s.results);
  const hovered = useStore((s) => s.hovered);
  const setHovered = useStore((s) => s.setHovered);
  const findCounterpart = useStore((s) => s.findCounterpart);

  const points = useMemo(() => {
    const feats = (results[model]?.features ?? []).filter((f) => f.layer === layer && f.pca);
    if (feats.length < 2) return null;
    const maxR = Math.max(...feats.map((f) => Math.hypot(f.pca![0], f.pca![1]))) || 1;
    const half = (SIZE - PAD * 2) / 2;
    return feats.map((f) => ({
      id: f.id,
      // svg y grows downward; flip so PC2 points up like a normal plot
      cx: PAD + half + (f.pca![0] / maxR) * half,
      cy: PAD + half - (f.pca![1] / maxR) * half,
      r: 2 + 2.6 * f.rel,
      colour: f.cluster !== undefined ? CLUSTER_COLOURS[f.cluster] : "#58C4DD",
      description: f.description,
      index: f.index,
    }));
  }, [results, model, layer]);

  if (!points) return null;
  const c = PAD + (SIZE - PAD * 2) / 2;

  return (
    <figure className="layerplot">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" role="img" aria-label={`PCA of layer ${layer}`}>
        <circle cx={c} cy={c} r={(SIZE - PAD * 2) / 2} className="lp-frame" />
        <line x1={PAD} y1={c} x2={SIZE - PAD} y2={c} className="lp-axis" />
        <line x1={c} y1={PAD} x2={c} y2={SIZE - PAD} className="lp-axis" />
        {points.map((p) => (
          <circle
            key={p.id}
            cx={p.cx}
            cy={p.cy}
            r={hovered === p.id ? p.r * 2.1 : p.r}
            fill={p.colour}
            className="lp-dot"
            opacity={hovered && hovered !== p.id ? 0.3 : 0.92}
            onMouseEnter={() => setHovered(p.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => void findCounterpart(p.id)}
          >
            <title>
              #{p.index} — {p.description}
            </title>
          </circle>
        ))}
      </svg>
      <figcaption>
        {points.length} matched · pc1 across, pc2 up · centre is the average matched concept
      </figcaption>
    </figure>
  );
}
