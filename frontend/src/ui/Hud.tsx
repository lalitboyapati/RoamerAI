import { useEffect, useRef } from "react";
import { modelsFor, useStore } from "../store";
import type { Mode, View } from "../types";
import { Examples } from "./Examples";
import { Guidance } from "./Guidance";
import { LayerBar } from "./LayerBar";
import { LayerPanel } from "./LayerPanel";
import { LayerTicks } from "./LayerTicks";
import { Readout } from "./Readout";
import { Schematic } from "./Schematic";

const MODES: { id: Mode; label: string }[] = [
  { id: "fast", label: "fast" },
  { id: "deep", label: "deep" },
];
const VIEWS: { id: View; label: string }[] = [
  { id: "gemma-2-2b", label: "gemma" },
  { id: "llama3.1-8b", label: "llama" },
  { id: "compare", label: "compare" },
];

function Toggle<T extends string>({
  options,
  active,
  onPick,
  hint,
}: {
  options: { id: T; label: string }[];
  active: T;
  onPick: (id: T) => void;
  hint: string;
}) {
  return (
    <div className="toggle">
      <span className="label">{hint}</span>
      <span className="toggle-row">
        {options.map((o, i) => (
          <span key={o.id}>
            {i > 0 && <span className="sep">·</span>}
            <button type="button" className={o.id === active ? "on" : ""} onClick={() => onPick(o.id)}>
              {o.label}
            </button>
          </span>
        ))}
      </span>
    </div>
  );
}

export function Hud() {
  const q = useStore((s) => s.q);
  const mode = useStore((s) => s.mode);
  const view = useStore((s) => s.view);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const results = useStore((s) => s.results);
  const manifest = useStore((s) => s.manifest);
  const setQuery = useStore((s) => s.setQuery);
  const setMode = useStore((s) => s.setMode);
  const askFor = useStore((s) => s.askFor);
  const setView = useStore((s) => s.setView);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== input.current) {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === "Escape") input.current?.blur();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const models = modelsFor(view);
  const searched = q.trim().length > 0;
  const empty = searched && !loading && !error && models.every((m) => (results[m]?.found ?? 0) === 0);

  return (
    <div className="hud">
      {loading && <div className="progress" />}

      <header>
        <span className="wordmark">ROAMERAI</span>
        <span className="tagline">
          does this model know your field — and where would you fine-tune it?
        </span>
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
        <Toggle options={MODES} active={mode} onPick={setMode} hint="match by" />
        <Toggle options={VIEWS} active={view} onPick={setView} hint="model" />
      </div>

      <Examples />

      {error && <p className="msg error">{error}</p>}
      {empty && (
        <p className="msg">
          nothing matched every word.{" "}
          {mode === "fast" ? (
            <button type="button" className="inline-link" onClick={() => askFor(q, "deep")}>
              match by meaning instead →
            </button>
          ) : (
            "try fewer words."
          )}
        </p>
      )}
      {!searched && (
        <p className="msg centred">
          type a concept from your field — every feature that encodes it lights up
        </p>
      )}

      <LayerTicks />
      <LayerPanel />
      <Schematic />

      <div className="right-rail">
        {manifest &&
          models.map((m) => (
            <div className="rail-block" key={m}>
              <Readout model={m} display={manifest.models[m].display} />
              <LayerBar model={m} nLayers={manifest.models[m].n_layers} />
              <Guidance model={m} />
            </div>
          ))}
      </div>

      <p className="hint">drag to orbit · scroll to zoom · click a layer to open it</p>
    </div>
  );
}
