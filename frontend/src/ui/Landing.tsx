import { useEffect, useState } from "react";
import { useStore } from "../store";
import { go } from "../route";
import { Manual } from "./Manual";

/**
 * The way in. Pick the models, then pick what to do with them.
 *
 * The picker is not decoration: each model is its own set of files, and only
 * the ones chosen here are ever downloaded. That is why the weight of each is
 * on the row — it is a real cost the visitor is agreeing to.
 */
export function Landing() {
  const catalog = useStore((s) => s.catalog);
  const stored = useStore((s) => s.selected);
  const begin = useStore((s) => s.begin);
  const [pick, setPick] = useState<string[]>([]);

  useEffect(() => {
    if (!catalog) return;
    const ids = Object.keys(catalog.models);
    const valid = stored.filter((m) => ids.includes(m));
    setPick(valid.length ? valid : ids.slice(0, 2));
  }, [catalog, stored]);

  if (!catalog) {
    return (
      <div className="landing">
        <p className="landing-loading">reading the catalogue…</p>
      </div>
    );
  }

  const ids = Object.keys(catalog.models);
  const toggle = (id: string) =>
    setPick((p) => (p.includes(id) ? p.filter((m) => m !== id) : [...ids.filter((m) => p.includes(m) || m === id)]));

  const bytes = pick.reduce((n, m) => n + catalog.models[m].bytes, 0);
  const features = pick.reduce((n, m) => n + catalog.models[m].count, 0);
  const enter = (where: "atlas" | "profile") => {
    begin(pick);
    go(where);
  };

  return (
    <div className="landing">
      <header>
        <span className="wordmark">ROMIRAI</span>
        <span className="tagline">does this model know your field — and where would you fine-tune it?</span>
      </header>

      <div className="landing-body">
        <div className="landing-choose">
      <p className="landing-lede">
        Language models decomposed into the patterns they learned. Search a concept from
        your field and watch which of those patterns respond, in which model, at which
        depth.
      </p>

      <span className="label">choose the models to compare</span>
      <ul className="picker">
        {ids.map((id) => {
          const m = catalog.models[id];
          const on = pick.includes(id);
          return (
            <li key={id}>
              <button type="button" className={on ? "pick on" : "pick"} onClick={() => toggle(id)}>
                <span className="pick-mark" aria-hidden />
                <span className="pick-name">{m.display}</span>
                <span className="pick-spec">
                  {m.nLayers} layers · {m.count.toLocaleString()} features indexed ·{" "}
                  {m.width.toLocaleString()} per layer
                </span>
                <span className="pick-size">{(m.bytes / 1e6).toFixed(0)} mb</span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="landing-cost">
        {pick.length === 0 ? (
          <span className="landing-warn">pick at least one model.</span>
        ) : (
          <>
            {features.toLocaleString()} features · about {(bytes / 1e6).toFixed(0)} mb of index,
            downloaded once and kept in this browser. only the models you pick are fetched.
          </>
        )}
      </p>

      <div className="landing-go">
        <button type="button" className="enter" disabled={!pick.length} onClick={() => enter("atlas")}>
          explore the map <span aria-hidden>→</span>
        </button>
        <button type="button" className="enter quiet" disabled={!pick.length} onClick={() => enter("profile")}>
          profile a domain <span aria-hidden>→</span>
        </button>
      </div>

      <p className="landing-foot">
        no account, no server, nothing sent anywhere. the search runs in this tab.
      </p>
        </div>

        <Manual />
      </div>
    </div>
  );
}
