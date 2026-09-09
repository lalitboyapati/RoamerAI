import { useState } from "react";

/**
 * What everything on this site means, in one place, before anyone commits to a
 * download. Written as prose rather than a glossary of tooltips: someone who
 * has never heard of a sparse autoencoder should be able to read this once and
 * understand every number the tool will show them — including the ones it
 * cannot justify.
 */
const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: "what a model is made of, here",
    body: (
      <>
        <p>
          A language model is a stack of layers. Text enters at the bottom, and at every layer
          the model reads what it has so far and writes a little more back — that running
          document is the <em>residual stream</em>, and it is the spine of the drawing.
        </p>
        <p>
          Inside those layers, meaning is not stored one-idea-per-neuron. It is spread across
          directions. A <em>sparse autoencoder</em> is a second, smaller network trained to pull
          that tangle apart into thousands of separate directions, each of which fires on one
          recognisable thing. Those are the <em>features</em> — 16,384 per layer in Gemma 2 2B,
          32,768 in the Llama models.
        </p>
        <p>
          Every feature has been given a plain-English description by an automated pass: “terms
          related to bleeding and blood clotting”, “instances of the word ‘until’”. Those
          descriptions are what this site searches. They come from Neuronpedia, and every lit
          point links back to its page there.
        </p>
      </>
    ),
  },
  {
    title: "what searching actually does",
    body: (
      <>
        <p>
          You type a concept. It is turned into a vector by a small sentence encoder running in
          your browser, and compared against the vector of every feature description. Anything
          close enough lights up.
        </p>
        <p>
          This is matching by <em>meaning</em>, not by words. “sepsis” appears in none of the
          59,000 descriptions, and the search still finds 162 features for it — septic shock,
          bacteraemia, infection markers. That is the whole point: your field&rsquo;s vocabulary
          does not have to match the index&rsquo;s.
        </p>
      </>
    ),
  },
  {
    title: "the map",
    body: (
      <>
        <p>
          Each model is drawn as a stack, layer 0 at the bottom. The faint points are features
          that did not match; the bright ones did. A feature&rsquo;s position never changes, so
          the same feature is always in the same place, in every search, forever.
        </p>
        <p>
          Colour is the cluster its meaning fell into — the descriptions that matched are grouped
          by what they mean, and each group named by the two words that distinguish it. Position
          on the disc is a projection of meaning, not of the model&rsquo;s weights: features near
          each other are described similarly.
        </p>
      </>
    ),
  },
  {
    title: "the numbers",
    body: (
      <>
        <dl className="manual-defs">
          <div>
            <dt>coverage</dt>
            <dd>
              A single 0–100 heuristic: how densely features respond, weighted by how many layers
              they span. It has no evaluation behind it. Read it as a rough altitude, not a
              benchmark.
            </dd>
          </div>
          <div>
            <dt>per 1k</dt>
            <dd>
              Matching features per thousand indexed descriptions. The raw count is not comparable
              between models — they index different amounts — so this is the number to compare.
            </dd>
          </div>
          <div>
            <dt>depth</dt>
            <dd>
              Where the responding features sit, as a fraction of the network. 0% is the first
              layer, 100% the last. Expressed this way a 26-layer and a 32-layer model can be read
              on one axis, which a layer number never allows.
            </dd>
          </div>
          <div>
            <dt>spread</dt>
            <dd>
              How evenly the hits are distributed across layers, normalised so models of different
              depth compare. Near 1 the concept is everywhere; low, and it is concentrated.
            </dd>
          </div>
          <div>
            <dt>agree</dt>
            <dd>
              Cosine between two models&rsquo; mean matched feature. Near 1 they mean the same thing
              by the concept; lower, and they are answering different senses of the same word.
            </dd>
          </div>
          <div>
            <dt>early · middle · late</dt>
            <dd>
              The network in thirds. Early layers carry surface form, middle layers carry meaning,
              late layers shape the answer. A thin middle band is the signal that a model does not
              hold a concept, whatever it can be prompted to say about it.
            </dd>
          </div>
        </dl>
      </>
    ),
  },
  {
    title: "profiling a domain",
    body: (
      <>
        <p>
          One concept is an anecdote. Define a set — <em>days of the week</em> as monday, tuesday,
          wednesday — or a whole field as a list of terms, and every one is run against every model
          you picked. The result is a matrix, an aggregate per set, and a verdict you can copy out.
        </p>
        <p>Runs are kept in folders in this browser, so a comparison can be returned to.</p>
      </>
    ),
  },
  {
    title: "what this cannot tell you",
    body: (
      <>
        <p>
          <em>It reads descriptions, not activations.</em> Nothing here runs either model. A
          feature described as being about protein folding might fire on something else; the
          descriptions are automated summaries and they are imperfect. About 5% of them are exact
          duplicates of another.
        </p>
        <p>
          <em>It reads a sample.</em> Roughly a thousand features per layer are indexed, out of
          16,384 or 32,768. A concept returning nothing is evidence, not proof.
        </p>
        <p>
          <em>The score is a heuristic.</em> Its saturation constant was tuned by hand against
          measured hit counts. No study relates it to how a fine-tune actually turns out.
        </p>
        <p>
          Used as a way to form hypotheses cheaply — which model, which layers, worth measuring
          properly — it is doing its job. Used as a measurement, it is being asked for more than
          it has.
        </p>
      </>
    ),
  },
];

export function Manual() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="manual">
      <span className="label">what everything means</span>
      <ol>
        {SECTIONS.map((s, i) => (
          <li key={s.title} className={open === i ? "on" : undefined}>
            <button type="button" onClick={() => setOpen(open === i ? null : i)}>
              <span className="manual-n">{String(i + 1).padStart(2, "0")}</span>
              {s.title}
            </button>
            {open === i && <div className="manual-body">{s.body}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
