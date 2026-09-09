import { useStore } from "../store";

/**
 * The one-time download, told honestly.
 *
 * The site has no backend, so the price of that is paid here instead: the
 * index and the sentence encoder come down once and are then cached by the
 * browser for good. Saying which and how far beats a spinner, and the intro
 * copy beside it is there to be read while this runs.
 */
const MB = (n: number) => `${(n / 1e6).toFixed(0)} mb`;

export function Loader() {
  const load = useStore((s) => s.load);
  if (load.phase === "ready") return null;

  const pct = load.total > 0 ? Math.min(1, load.loaded / load.total) : 0;
  const what =
    load.phase === "index" ? "reading the feature index" : "starting the sentence encoder";

  return (
    <div className="loader">
      <span className="label">first visit</span>
      <p className="loader-what">
        {what}
        {load.total > 0 && (
          <span className="loader-size">
            {" "}
            · {MB(load.loaded)} of {MB(load.total)}
          </span>
        )}
      </p>
      <span className="loader-rule">
        <span style={{ width: `${Math.round(pct * 100)}%` }} />
      </span>
      <p className="loader-note">
        this is the whole search engine, not a page of results — it downloads once
        and every search after it is instant, offline, and answers from the full
        59,168 features rather than a page of them.
      </p>
    </div>
  );
}
