import { Fragment, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { centroidAgreement, searchModels, THIN } from "../search";
import { coverageScore } from "../coverage";
import { go } from "../route";
import type { ModelHits, ModelId } from "../types";

/**
 * The domain report card.
 *
 * One concept is an anecdote. The person this is for is not choosing a model
 * for "sepsis" — they are choosing one for a field, and a field is a set of
 * things: "days of the week" is monday through sunday, not the phrase itself.
 * So the unit here is a named set, every member is searched, and the set is
 * scored on its members.
 *
 * Runs are kept in folders in this browser. Only the numbers are stored, never
 * the embeddings, so a folder is a few kilobytes.
 */
const PRESETS: Record<string, string> = {
  "days of the week": "days of the week: monday, tuesday, wednesday, thursday, friday, saturday, sunday",
  clinical: [
    "infection: sepsis, bacteraemia, antibiotic resistance, infection control",
    "imaging: radiology report, ct scan, mri, ultrasound",
    "workflow: patient triage, discharge summary, clinical trial, medication dosage",
  ].join("\n"),
  legal: [
    "contract: contract law, breach of contract, liability, indemnity",
    "procedure: legal citations, jurisdiction, statutory interpretation, evidence",
    "criminal: criminal sentencing, prosecution, testimony, appeal",
  ].join("\n"),
  finance: [
    "policy: monetary policy, interest rates, inflation, central bank",
    "risk: financial risk, credit rating, derivatives, hedging",
    "reporting: tax filing, audit, balance sheet, earnings",
  ].join("\n"),
  "molecular biology": [
    "genetics: gene expression, transcription, dna sequencing, mutation",
    "protein: protein folding, enzyme activity, amino acid, binding site",
    "cell: cell membrane, mitochondria, apoptosis, signalling",
  ].join("\n"),
  software: [
    "testing: unit tests, integration test, code coverage, assertion",
    "infrastructure: kubernetes, container, load balancer, deployment",
    "data: database query, api endpoints, serialization, caching",
  ].join("\n"),
};

const FOLDERS = "romirai.folders";

interface SetSpec { name: string; terms: string[] }
interface Cell { score: number; density: number; depth: number; found: number; spread: number }
interface TermRow { term: string; per: Record<ModelId, Cell>; agreement: number | null }
interface SetResult { name: string; terms: TermRow[]; agg: Record<ModelId, Cell> }
interface Folder { id: string; name: string; at: number; models: ModelId[]; source: string; sets: SetResult[] }

/** `days of the week: monday, tuesday` — a bare line is a set of one. */
function parseSets(text: string): SetSpec[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(":");
      if (i < 0) return { name: line, terms: [line] };
      const name = line.slice(0, i).trim() || line;
      const terms = line.slice(i + 1).split(",").map((t) => t.trim()).filter(Boolean);
      return { name, terms: terms.length ? terms : [name] };
    })
    .slice(0, 24);
}

const readFolders = (): Folder[] => {
  try {
    const v = JSON.parse(localStorage.getItem(FOLDERS) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const writeFolders = (f: Folder[]) => {
  try {
    localStorage.setItem(FOLDERS, JSON.stringify(f.slice(0, 40)));
  } catch {
    /* out of quota; the run is still on screen */
  }
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function Profile() {
  const catalog = useStore((s) => s.catalog);
  const selected = useStore((s) => s.selected);
  const [text, setText] = useState(PRESETS["days of the week"]);
  const [sets, setSets] = useState<SetResult[] | null>(null);
  const [ranModels, setRanModels] = useState<ModelId[]>([]);
  const [busy, setBusy] = useState<{ at: number; of: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [folders, setFolders] = useState<Folder[]>([]);
  const [name, setName] = useState("");

  useEffect(() => setFolders(readFolders()), []);

  // A set line wraps to two or three visual rows in a 320px column, so a row
  // count taken from newlines clips the box. Measure what it actually needs.
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(320, Math.max(74, el.scrollHeight))}px`;
  }, [text]);

  if (!catalog) {
    return (
      <div className="profile">
        <p className="landing-loading">reading the catalogue…</p>
      </div>
    );
  }
  const models = selected.length ? selected : Object.keys(catalog.models).slice(0, 2);
  const specs = parseSets(text);
  const termCount = specs.reduce((n, s) => n + s.terms.length, 0);

  const cellOf = (h: ModelHits | undefined, m: ModelId): Cell => ({
    score: h ? coverageScore(h.density, Object.values(h.perLayer).filter((n) => n > 0).length, catalog.models[m].nLayers) : 0,
    density: h?.density ?? 0,
    depth: h?.depth ?? 0,
    found: h?.found ?? 0,
    spread: h?.spread ?? 0,
  });

  const run = async () => {
    setErr(null);
    let done = 0;
    setBusy({ at: 0, of: termCount });
    try {
      const out: SetResult[] = [];
      for (const spec of specs) {
        const terms: TermRow[] = [];
        for (const term of spec.terms) {
          const { results } = await searchModels(term, models);
          terms.push({
            term,
            per: Object.fromEntries(models.map((m) => [m, cellOf(results[m], m)])),
            agreement: models.length > 1 ? centroidAgreement(results[models[0]], results[models[1]]) : null,
          });
          setBusy({ at: ++done, of: termCount });
        }
        out.push({
          name: spec.name,
          terms,
          agg: Object.fromEntries(
            models.map((m) => [
              m,
              {
                score: Math.round(mean(terms.map((t) => t.per[m].score))),
                density: mean(terms.map((t) => t.per[m].density)),
                depth: mean(terms.map((t) => t.per[m].depth)),
                found: Math.round(mean(terms.map((t) => t.per[m].found))),
                spread: mean(terms.map((t) => t.per[m].spread)),
              },
            ])
          ),
        });
      }
      setSets(out);
      setRanModels(models);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    if (!sets) return;
    const f: Folder = {
      id: `${Date.now()}`,
      name: name.trim() || sets.map((s) => s.name).join(" + ").slice(0, 48),
      at: Date.now(),
      models: ranModels,
      source: text,
      sets,
    };
    const next = [f, ...folders.filter((x) => x.name !== f.name)];
    setFolders(next);
    writeFolders(next);
    setName("");
  };
  const openFolder = (f: Folder) => {
    setText(f.source);
    setSets(f.sets);
    setRanModels(f.models);
  };
  const remove = (id: string) => {
    const next = folders.filter((f) => f.id !== id);
    setFolders(next);
    writeFolders(next);
  };

  const cols = ranModels.length ? ranModels : models;
  const best = sets?.length
    ? [...cols]
        .map((m) => ({ m, s: Math.round(mean(sets.flatMap((set) => set.terms.map((t) => t.per[m]?.score ?? 0)))) }))
        .sort((a, b) => b.s - a.s)[0]
    : null;

  const copy = () => {
    if (!sets) return;
    const head = ["set / concept", ...cols.flatMap((m) => [`${catalog.models[m].display} score`, "per 1k", "depth"])];
    const line = (label: string, per: Record<ModelId, Cell>) =>
      `| ${label} | ` +
      cols
        .map((m) => {
          const c = per[m];
          return `${c?.score ?? 0} | ${(c?.density ?? 0).toFixed(1)} | ${c?.found ? Math.round(c.depth * 100) + "%" : "—"}`;
        })
        .join(" | ") +
      " |";
    const md = [
      `| ${head.join(" | ")} |`,
      `| ${head.map(() => "---").join(" | ")} |`,
      ...sets.flatMap((s) => [line(`**${s.name}**`, s.agg), ...s.terms.map((t) => line(`  ${t.term}`, t.per))]),
    ].join("\n");
    void navigator.clipboard?.writeText(md);
  };

  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const cells = (per: Record<ModelId, Cell>, klass: string) =>
    cols.map((m) => {
      const c = per[m];
      const thin = (c?.found ?? 0) < THIN;
      return (
        <Fragment key={m}>
          <td className={`num strong grp ${klass}`}>{c?.score ?? 0}</td>
          <td className={`num ${klass}`}>{(c?.density ?? 0).toFixed(1)}</td>
          <td className={`num ${klass}${thin ? " thin" : ""}`}>
            {c?.found ? `${Math.round(c.depth * 100)}%` : "—"}
          </td>
        </Fragment>
      );
    });

  const ran = sets ?? null;

  return (
    <div className="profile">
      <header>
        <span className="wordmark">ROMIRAI</span>
        <span className="tagline">domain profile</span>
        <button type="button" className="focus-btn" onClick={() => go("atlas")}>
          the map →
        </button>
        <button type="button" className="focus-btn" onClick={() => go("layers")}>
          layer grid
        </button>
        <button type="button" className="focus-btn" onClick={() => go("landing")}>
          models
        </button>
      </header>

      <div className="profile-body">
        <div className="profile-side">
          <section className="side-block">
            <span className="label">concept sets</span>
            <div className="presets">
              {Object.keys(PRESETS).map((k) => (
                <button type="button" key={k} onClick={() => setText(PRESETS[k])}>
                  {k}
                </button>
              ))}
            </div>
            <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
            <p className="profile-help">
              one set per line, as <em>name: member, member</em>. a line with no colon is a set of one.
            </p>

            {specs.length > 0 && (
              <ul className="parsed">
                {specs.map((sp) => (
                  <li key={sp.name}>
                    <span className="parsed-name">{sp.name}</span>
                    <span className="parsed-terms">
                      {sp.terms.map((t) => (
                        <span key={t} className="parsed-term">
                          {t}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="profile-run">
              <button type="button" className="enter" disabled={!!busy || !termCount} onClick={() => void run()}>
                {busy
                  ? `running ${busy.at} of ${busy.of}…`
                  : `profile ${specs.length} set${specs.length === 1 ? "" : "s"} · ${termCount} concept${termCount === 1 ? "" : "s"}`}{" "}
                <span aria-hidden>→</span>
              </button>
            </div>
            <p className="profile-against">against {models.map((m) => catalog.models[m].display).join(", ")}</p>
            {err && <p className="msg error">{err}</p>}
          </section>

          <section className="side-block folders">
            <span className="label">
              folders {folders.length > 0 && <span className="side-n">{folders.length}</span>}
            </span>
            {folders.length === 0 ? (
              <p className="note">saved runs are kept here, in this browser.</p>
            ) : (
              <ul>
                {folders.map((f) => (
                  <li key={f.id}>
                    <button type="button" className="folder-open" onClick={() => openFolder(f)}>
                      <span className="folder-name">{f.name}</span>
                      <span className="folder-meta">
                        {f.sets.reduce((n, x) => n + x.terms.length, 0)} concepts ·{" "}
                        {f.models.length} model{f.models.length === 1 ? "" : "s"} ·{" "}
                        {new Date(f.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="folder-del"
                      onClick={() => remove(f.id)}
                      aria-label={`delete ${f.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="profile-main">
          {!ran && !busy && (
            <p className="main-empty">
              the table appears here: one row per set, expandable to its members, one column group
              per model. pick a preset or write your own, then run it.
            </p>
          )}
      {sets && (
        <>
          <table className="matrix">
            <thead>
              <tr>
                <th className="c-concept">set · concept</th>
                {cols.map((m) => (
                  <th key={m} colSpan={3}>
                    {catalog.models[m].display}
                  </th>
                ))}
                {cols.length > 1 && (
                  <th className="c-agree">
                    agree
                    <span className="c-agree-pair">
                      {catalog.models[cols[0]].display} · {catalog.models[cols[1]].display}
                    </span>
                  </th>
                )}
              </tr>
              <tr className="subhead">
                <th />
                {cols.map((m) => (
                  <Fragment key={m}>
                    <th>score</th>
                    <th>per 1k</th>
                    <th>depth</th>
                  </Fragment>
                ))}
                {cols.length > 1 && <th />}
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => (
                <Fragment key={s.name}>
                  <tr className="set-row">
                    <td className="c-concept">
                      <button type="button" className="set-toggle" onClick={() => toggle(s.name)}>
                        <span className="set-caret">{open.has(s.name) ? "−" : "+"}</span>
                        {s.name}
                        <span className="set-n">{s.terms.length}</span>
                      </button>
                    </td>
                    {cells(s.agg, "")}
                    {cols.length > 1 && <td className="num c-agree grp" />}
                  </tr>
                  {open.has(s.name) &&
                    s.terms.map((t) => (
                      <tr key={t.term} className="term-row">
                        <td className="c-concept term">{t.term}</td>
                        {cells(t.per, "quiet")}
                        {cols.length > 1 && (
                          <td className="num c-agree grp quiet">{t.agreement === null ? "—" : t.agreement.toFixed(3)}</td>
                        )}
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>

          <p className="matrix-note">
            a set&rsquo;s row is the mean of its members. <em>score</em> is the coverage heuristic.{" "}
            <em>per 1k</em> is hits per thousand indexed descriptions — the only count comparable
            between models of different size. <em>depth</em> is where the responding features sit as
            a fraction of the network, so a 26-layer and a 32-layer model read on one scale; it is
            dimmed under {THIN} features, where it describes a handful of points rather than a
            distribution. <em>agree</em> is the cosine between the two models&rsquo; mean matched
            embedding.
          </p>

          {best && (
            <div className="verdict-block">
              <p className="verdict strong">
                {catalog.models[best.m].display} holds this best — mean coverage {best.s} across{" "}
                {sets.reduce((n, s) => n + s.terms.length, 0)} concepts in {sets.length} set
                {sets.length === 1 ? "" : "s"}.
              </p>
              <div className="save-row">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="name this run"
                  spellCheck={false}
                />
                <button type="button" className="enter quiet" onClick={save}>
                  save to folders <span aria-hidden>→</span>
                </button>
                <button type="button" className="enter quiet" onClick={copy}>
                  copy as markdown <span aria-hidden>→</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}
        </div>
      </div>
    </div>
  );
}
