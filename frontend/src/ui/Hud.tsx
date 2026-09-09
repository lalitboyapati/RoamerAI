import { useEffect, useRef } from "react";
import { GUIDE_ANCHORS, useStore } from "../store";
import { Examples } from "./Examples";
import { Guide } from "./Guide";
import { Intro, IntroPrompt } from "./Intro";
import { Loader } from "./Loader";
import { ModelBar } from "./ModelBar";
import { DepthProfile } from "./DepthProfile";
import { Agreement } from "./Agreement";
import { go } from "../route";
import { Guidance } from "./Guidance";
import { LayerBar } from "./LayerBar";
import { LayerPanel } from "./LayerPanel";
import { LayerTicks } from "./LayerTicks";
import { Readout } from "./Readout";
import { Schematic } from "./Schematic";
import { Legend } from "./Legend";
import { CounterpartPanel } from "./Counterpart";
import { Sources } from "./Sources";
import { ViewBar } from "./ViewBar";


export function Hud() {
  const q = useStore((s) => s.q);
  const selected = useStore((s) => s.selected);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const results = useStore((s) => s.results);
  const catalog = useStore((s) => s.catalog);
  const setQuery = useStore((s) => s.setQuery);
  const focus = useStore((s) => s.focus);
  const toggleFocus = useStore((s) => s.toggleFocus);
  const setDrag = useStore((s) => s.setDrag);
  const toggleSources = useStore((s) => s.toggleSources);
  const sourcesOpen = useStore((s) => s.sourcesOpen);
  const guideStep = useStore((s) => s.guideStep);
  const ready = useStore((s) => s.load.phase === "ready");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // shortcuts must not fire while a control has focus: space activates buttons,
      // and letters belong to the search field
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLButtonElement || el instanceof HTMLTextAreaElement;
      if (e.key === "/" && document.activeElement !== input.current) {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === "Escape") input.current?.blur();
      if (typing) return;
      if (e.key === "f") toggleFocus();
      if (e.key === "g") {
        const { shape, setShape } = useStore.getState();
        setShape(shape === "globe" ? "stack" : "globe");
      }
      if (e.key === "s") toggleSources();
      if (e.key === " ") {
        e.preventDefault();
        setDrag(useStore.getState().drag === "pan" ? "orbit" : "pan");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFocus, toggleSources, setDrag]);

  const models = selected;
  const searched = q.trim().length > 0;
  const empty = searched && !loading && !error && models.every((m: string) => (results[m]?.found ?? 0) === 0);

  return (
    <div
      className={focus ? "hud focus" : "hud"}
      data-guide={guideStep === null ? undefined : GUIDE_ANCHORS[guideStep]}
    >
      {loading && <div className="progress" />}

      <header>
        <span className="wordmark">ROMIRAI</span>
        <span className="tagline">
          does this model know your field — and where would you fine-tune it?
        </span>
        <button type="button" className="focus-btn" onClick={() => go("profile")}>
          profile a domain
        </button>
        <button type="button" className="focus-btn" onClick={toggleSources} title="S">
          {sourcesOpen ? "hide sources" : "sources"}
        </button>
        <button type="button" className="focus-btn" onClick={toggleFocus} title="F">
          {focus ? "show panels" : "focus"}
        </button>
      </header>

      <div className="controls">
        <label className="field">
          <span className="label">concept</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="sepsis"
            spellCheck={false}
            autoFocus
          />
        </label>
        <ModelBar />
      </div>

      <Examples />

      {error && <p className="msg error">{error}</p>}
      {empty && (
        <p className="msg">
          nothing lit up. what that does and does not prove is in the rail
          <span className="msg-arrow" aria-hidden> →</span>
        </p>
      )}
      {searched && !ready && !error && (
        <p className="msg">the index is still loading — this runs the moment it lands.</p>
      )}
      {!searched && !error && ready && <IntroPrompt />}

      <LayerTicks />
      <LayerPanel />
      <Schematic />

      <div className="right-rail">
        <Loader />
        {models.length > 1 && ready && (
          <div className="rail-block">
            <DepthProfile models={models} />
            <Agreement models={models} />
          </div>
        )}
        {!searched && !error && ready && <Intro />}
        {catalog &&
          models.map((m: string) => (
            <div className="rail-block" key={m}>
              <Readout model={m} display={catalog.models[m].display} />
              <LayerBar model={m} nLayers={catalog.models[m].nLayers} />
              <Guidance model={m} />
              <Legend model={m} />
            </div>
          ))}
      </div>

      <Sources />

      <CounterpartPanel />

      <ViewBar />

      <Guide />

      <p className="too-small">
        <strong>RomirAI</strong> draws a language model as a stack you turn, search and
        pick apart. It needs a screen wide enough to hold the model and the reading side
        by side — open it on a desktop.
      </p>
    </div>
  );
}
