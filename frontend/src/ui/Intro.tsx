import { useStore } from "../store";

/**
 * The void before the first search, in two halves.
 *
 * The prompt sits with the search field. The teaching sits in the right rail —
 * the column that will hold the reading once there is one — so a stranger learns
 * where the answer is going to appear by watching it replace this.
 */
export function IntroPrompt() {
  return <p className="intro-prompt">type a concept from your field, or pick one above.</p>;
}

export function Intro() {
  const catalog = useStore((s) => s.catalog);
  const selected = useStore((s) => s.selected);

  if (!catalog || !selected.length) return null;
  const model = catalog.models[selected[0]];

  return (
    <div className="intro">
      <p className="intro-lede">the reading appears here.</p>
      <p>
        every faint point in the stack is a <em>feature</em> — one pattern the model
        learned to recognise, carrying a plain-english description of what makes it fire.
      </p>
      <p>
        searching lights the ones whose description matches yours, and this column says
        how much of the concept {model.display} holds, and which layers hold it.
      </p>
    </div>
  );
}
