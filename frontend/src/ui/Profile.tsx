import { Fragment, useState } from "react";
import { useStore } from "../store";
import { centroidAgreement, searchModels, THIN } from "../search";
import { coverageScore } from "../coverage";
import { go } from "../route";
import type { ModelHits, ModelId } from "../types";

/**
 * The domain report card.
 *
 * One concept is an anecdote. The person this is for is not choosing a model
 * for "sepsis" — they are choosing one for a field, and a field is a list. This
 * runs the whole list against every selected model and lays the answers out as
 * a matrix, because that is the shape of the decision.
 */
const PRESETS: Record<string, string[]> = {
  clinical: ["sepsis", "medication dosage", "radiology report", "patient triage", "discharge summary", "clinical trial"],
  legal: ["contract law", "legal citations", "criminal sentencing", "statutory interpretation", "liability", "jurisdiction"],
  finance: ["monetary policy", "financial risk", "tax filing", "credit rating", "derivatives", "audit"],
  "molecular biology": ["gene expression", "protein folding", "enzyme activity", "transcription", "cell membrane", "molecular biology"],
  software: ["unit tests", "kubernetes", "api endpoints", "memory allocation", "version control", "database query"],
};

interface Row {
  concept: string;
  per: Record<ModelId, ModelHits>;
  agreement: number | null;
}

export function Profile() {
  const catalog = useStore((s) => s.catalog);
  const selected = useStore((s) => s.selected);
  const [text, setText] = useState(PRESETS.clinical.join("\n"));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  if (!catalog) {
    return (
      <div className="profile">
        <p className="landing-loading">reading the catalogue…</p>
      </div>
    );
  }
  const models = selected.length ? selected : Object.keys(catalog.models).slice(0, 2);
  const concepts = text.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 40);

  const scoreOf = (h: ModelHits | undefined, m: ModelId) =>
    h ? coverageScore(h.density, Object.values(h.perLayer).filter((n) => n > 0).length, catalog.models[m].nLayers) : 0;

  const run = async () => {
    setErr(null);
    setBusy(1);
    try {
      const out: Row[] = [];
      for (const c of concepts) {
        const { results } = await searchModels(c, models);
        out.push({
          concept: c,
          per: results,
          agreement: models.length > 1 ? centroidAgreement(results[models[0]], results[models[1]]) : null,
        });
        setBusy(out.length + 1);
      }
      setRows(out);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(0);
    }
  };

  const summary = () => {
    if (!rows?.length) return null;
    const per = models.map((m) => {
      const scores = rows.map((r) => scoreOf(r.per[m], m));
      const depths = rows.map((r) => r.per[m]?.depth ?? 0);
      const thin = rows.filter((r) => (r.per[m]?.found ?? 0) < THIN).map((r) => r.concept);
      return {
        m,
        mean: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        depth: depths.reduce((a, b) => a + b, 0) / depths.length,
        thin,
      };
    });
    return { per, best: [...per].sort((a, b) => b.mean - a.mean)[0] };
  };
  const sum = summary();

  const copy = () => {
    if (!rows) return;
    const head = ["concept", ...models.flatMap((m) => [`${catalog.models[m].display} score`, "per 1k", "depth"])];
    const md = [
      `| ${head.join(" | ")} |`,
      `| ${head.map(() => "---").join(" | ")} |`,
      ...rows.map(
        (r) =>
          `| ${r.concept} | ` +
          models
            .map((m) => {
              const h = r.per[m];
              return `${scoreOf(h, m)} | ${h ? h.density.toFixed(1) : "0"} | ${h && h.found ? Math.round(h.depth * 100) + "%" : "—"}`;
            })
            .join(" | ") +
          " |"
      ),
    ].join("\n");
    void navigator.clipboard?.writeText(md);
  };

  return (
    <div className="profile">
      <header>
        <span className="wordmark">ROMIRAI</span>
        <span className="tagline">domain profile</span>
        <button type="button" className="focus-btn" onClick={() => go("atlas")}>
          the map →
        </button>
        <button type="button" className="focus-btn" onClick={() => go("landing")}>
          models
        </button>
      </header>

      <div className="profile-input">
        <span className="label">a field, as a list of concepts</span>
        <div className="presets">
          {Object.keys(PRESETS).map((k) => (
            <button type="button" key={k} onClick={() => setText(PRESETS[k].join("\n"))}>
              {k}
            </button>
          ))}
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={7} />
        <div className="profile-run">
          <button type="button" className="enter" disabled={!!busy || !concepts.length} onClick={() => void run()}>
            {busy ? `running ${busy} of ${concepts.length}…` : `profile ${concepts.length} concept${concepts.length === 1 ? "" : "s"}`}{" "}
            <span aria-hidden>→</span>
          </button>
          <span className="profile-against">against {models.map((m) => catalog.models[m].display).join(", ")}</span>
        </div>
        {err && <p className="msg error">{err}</p>}
      </div>

      {rows && (
        <>
          <table className="matrix">
            <thead>
              <tr>
                <th className="c-concept">concept</th>
                {models.map((m) => (
                  <th key={m} colSpan={3}>
                    {catalog.models[m].display}
                  </th>
                ))}
                {models.length > 1 && (
                  <th className="c-agree">
                    agree
                    <span className="c-agree-pair">
                      {catalog.models[models[0]].display} · {catalog.models[models[1]].display}
                    </span>
                  </th>
                )}
              </tr>
              <tr className="subhead">
                <th />
                {models.map((m) => (
                  <Fragment key={m}>
                    <th>score</th>
                    <th>per 1k</th>
                    <th>depth</th>
                  </Fragment>
                ))}
                {models.length > 1 && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.concept}>
                  <td className="c-concept">{r.concept}</td>
                  {models.map((m) => {
                    const h = r.per[m];
                    const thin = (h?.found ?? 0) < THIN;
                    return (
                      <Fragment key={m}>
                        <td className="num strong">{scoreOf(h, m)}</td>
                        <td className="num">{h ? h.density.toFixed(1) : "0"}</td>
                        <td className={thin ? "num thin" : "num"}>
                          {h && h.found ? `${Math.round(h.depth * 100)}%` : "—"}
                        </td>
                      </Fragment>
                    );
                  })}
                  {models.length > 1 && (
                    <td className="num c-agree">{r.agreement === null ? "—" : r.agreement.toFixed(3)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <p className="matrix-note">
            <em>score</em> is the coverage heuristic. <em>per 1k</em> is hits per thousand indexed
            descriptions — the only count comparable between models of different size.{" "}
            <em>depth</em> is where the responding features sit as a fraction of the network, so a
            26-layer and a 32-layer model read on one scale; it is dimmed under {THIN} features,
            where it describes a handful of points rather than a distribution. <em>agree</em> is the
            cosine between the two models&rsquo; mean matched embedding — whether they mean the same
            thing by the concept.
          </p>

          {sum && (
            <div className="verdict-block">
              <p className="verdict strong">
                {catalog.models[sum.best.m].display} holds this domain best — mean coverage{" "}
                {sum.best.mean}, concepts sitting {Math.round(sum.best.depth * 100)}% deep on average.
              </p>
              <ul className="summary">
                {sum.per.map((p) => (
                  <li key={p.m}>
                    <span className="s-name">{catalog.models[p.m].display}</span>
                    <span className="s-mean">{p.mean}</span>
                    <span className="s-depth">{Math.round(p.depth * 100)}% deep</span>
                    <span className="s-thin">
                      {p.thin.length
                        ? `thin on ${p.thin.slice(0, 3).join(", ")}${p.thin.length > 3 ? "…" : ""}`
                        : "nothing thin"}
                    </span>
                  </li>
                ))}
              </ul>
              <button type="button" className="enter quiet" onClick={copy}>
                copy as markdown <span aria-hidden>→</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
