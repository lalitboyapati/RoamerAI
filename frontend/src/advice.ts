import type { ManifestModel, ModelResult } from "./types";

/**
 * Turning the search result into something a working engineer can act on.
 *
 * The reading is the standard interpretability one: early layers carry tokens
 * and surface form, middle layers carry concepts, late layers shape the output
 * for the task. Domain knowledge that a model genuinely holds shows up in the
 * middle band. If the middle band is empty, no amount of prompt engineering
 * will conjure the concept — that is a fine-tuning job.
 */

export type Verdict = "strong" | "partial" | "weak" | "absent";

export interface Band {
  key: "early" | "middle" | "late";
  label: string;
  role: string;
  from: number;
  to: number;
  matched: number;
  share: number;
}

export interface Diagnosis {
  verdict: Verdict;
  headline: string;
  detail: string;
  action: string;
  bands: Band[];
  /** layers with no match at all */
  gaps: number[];
  /** the contiguous run of layers worth targeting first */
  focus: [number, number] | null;
}

const VERDICT_TEXT: Record<Verdict, { headline: string }> = {
  strong: { headline: "well represented" },
  partial: { headline: "partially represented" },
  weak: { headline: "thinly represented" },
  absent: { headline: "not represented" },
};

function verdictOf(score: number, found: number): Verdict {
  if (found === 0) return "absent";
  if (score >= 55) return "strong";
  if (score >= 25) return "partial";
  return "weak";
}

/** Longest run of layers inside [from,to] holding fewer than `threshold` matches. */
function weakestRun(
  perLayer: Record<number, number>,
  from: number,
  to: number,
  threshold: number
): [number, number] | null {
  let best: [number, number] | null = null;
  let start = -1;
  for (let L = from; L <= to + 1; L++) {
    const thin = L <= to && (perLayer[L] ?? 0) < threshold;
    if (thin && start === -1) start = L;
    if (!thin && start !== -1) {
      const run: [number, number] = [start, L - 1];
      if (!best || run[1] - run[0] > best[1] - best[0]) best = run;
      start = -1;
    }
  }
  return best;
}

export function diagnose(
  result: ModelResult | undefined,
  model: ManifestModel,
  concept: string
): Diagnosis | null {
  if (!result) return null;

  const n = model.n_layers;
  const third = Math.floor(n / 3);
  const spec: Omit<Band, "matched" | "share">[] = [
    { key: "early", label: "early", role: "tokens & surface form", from: 0, to: third - 1 },
    { key: "middle", label: "middle", role: "concepts & meaning", from: third, to: 2 * third - 1 },
    { key: "late", label: "late", role: "task & output shaping", from: 2 * third, to: n - 1 },
  ];

  const total = Math.max(1, Object.values(result.perLayer).reduce((a, b) => a + b, 0));
  const bands: Band[] = spec.map((b) => {
    let matched = 0;
    for (let L = b.from; L <= b.to; L++) matched += result.perLayer[L] ?? 0;
    return { ...b, matched, share: matched / total };
  });

  const gaps: number[] = [];
  for (let L = 0; L < n; L++) if (!(result.perLayer[L] ?? 0)) gaps.push(L);

  const middle = bands[1];
  const verdict = verdictOf(result.score, result.found);
  const q = concept.trim() || "this concept";

  // Thin patches inside the concept band are the first thing worth adapting.
  const avg = total / Math.max(1, result.layersHit);
  const focus =
    verdict === "absent"
      ? [middle.from, middle.to] as [number, number]
      : weakestRun(result.perLayer, middle.from, middle.to, Math.max(1, avg * 0.5)) ??
        weakestRun(result.perLayer, 0, n - 1, Math.max(1, avg * 0.5));

  const range = focus ? (focus[0] === focus[1] ? `layer ${focus[0]}` : `layers ${focus[0]}–${focus[1]}`) : null;

  let detail: string;
  let action: string;

  switch (verdict) {
    case "strong":
      detail = `${result.found.toLocaleString()} features respond to "${q}", spread over ${result.layersHit} of ${n} layers, with ${Math.round(middle.share * 100)}% of them in the concept-carrying middle band.`;
      action = `The model already holds this domain. Prefer instruction tuning or a small LoRA on the late layers — you are shaping output format, not teaching the subject.`;
      break;
    case "partial":
      detail = `${result.found.toLocaleString()} features respond to "${q}", but only across ${result.layersHit} of ${n} layers. The middle band carries ${Math.round(middle.share * 100)}% of them.`;
      action = range
        ? `Representation is uneven. A LoRA on ${range} — the thinnest stretch inside the concept band — is the cheapest place to add depth.`
        : `Representation is uneven; a small LoRA over the middle layers is the cheapest place to add depth.`;
      break;
    case "weak":
      detail = `Only ${result.found.toLocaleString()} features respond to "${q}", across ${result.layersHit} of ${n} layers. That is close to noise for a concept this specific.`;
      action = range
        ? `Prompting will not fix this. Plan domain-adaptive training on in-house text, and target adapters at ${range} first.`
        : `Prompting will not fix this. Plan domain-adaptive training on in-house text before relying on this model.`;
      break;
    default:
      detail = `No feature in this model has a description matching "${q}".`;
      action = `Either the wording is off — try deep mode, which matches meaning rather than words — or the model genuinely has no representation to build on.`;
  }

  return {
    verdict,
    headline: `"${q}" is ${VERDICT_TEXT[verdict].headline}`,
    detail,
    action,
    bands,
    gaps,
    focus,
  };
}
