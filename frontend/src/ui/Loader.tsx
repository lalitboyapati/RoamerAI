import { useStore } from "../store";

/**
 * The first visit, made worth sitting through.
 *
 * There is no server, so the search engine has to come to the visitor once.
 * That is a real thing happening, not a spinner, and it is told as one: what is
 * arriving, how much of it, and why any of it is necessary. The model builds
 * itself layer by layer in the scene alongside this, so the thing being waited
 * for is also the thing on screen.
 */
const MB = (n: number) => `${(n / 1e6).toFixed(1)} mb`;

export function Loader() {
  const load = useStore((s) => s.load);
  const catalog = useStore((s) => s.catalog);
  const selected = useStore((s) => s.selected);
  if (load.phase === "ready") return null;

  const pct = load.total > 0 ? Math.min(1, load.loaded / load.total) : 0;
  const back = load.restored === true;
  const index = load.phase === "index";

  const heading = back
    ? index
      ? "reading the atlas from this browser"
      : "waking the encoder"
    : index
      ? "downloading the feature atlas"
      : "downloading the sentence encoder";

  const layers = catalog && selected.length
    ? selected.map((m) => catalog.models[m].nLayers).join(" and ")
    : "26 and 32";

  return (
    <div className="loader">
      <span className="label">{back ? "already yours" : "first visit"}</span>
      <p className="loader-what">
        {heading}
        {/* a byte count next to "kept from your last visit" reads as a download */}
        {!back && load.total > 0 && (
          <span className="loader-size">
            {" "}
            · {MB(load.loaded)} of {MB(load.total)}
          </span>
        )}
      </p>
      <span className="loader-rule">
        <span style={{ width: `${Math.round(pct * 100)}%` }} />
      </span>

      {index ? (
        <p className="loader-read">
          Two language models, taken apart. Gemma 2 2B and Llama 3.1 8B have been
          decomposed into sparse-autoencoder features — <em>59,168</em> of them across{" "}
          {layers} layers, each one a pattern the model learned to recognise, carrying a
          plain-english description of what makes it fire. That is what is arriving, and
          what is drawing itself in the middle of the screen.
        </p>
      ) : (
        <p className="loader-read">
          And the part that reads your question. Turning a typed concept into a direction
          in that space normally means a server; here it runs in this tab instead. Which
          is why nothing you search ever leaves this machine, and why every search after
          this one takes about twenty milliseconds.
        </p>
      )}

      <p className="loader-note">
        {back
          ? "kept from your last visit — nothing is being downloaded."
          : "this happens once. the browser is asked to keep it, and every visit after this one starts here immediately."}
      </p>
    </div>
  );
}
