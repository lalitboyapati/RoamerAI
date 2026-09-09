/**
 * Re-embed the corpus with the exact model the browser will run.
 *
 * The vectors currently in Typesense came from its own MiniLM-L12 at full
 * precision. The browser runs a quantised ONNX build, so query and document
 * vectors would live in subtly different spaces. Embedding both sides with the
 * same file removes that mismatch, and L6 is 10 MB smaller than L12 for a
 * difference in ranking quality this corpus will not notice.
 */
import { pipeline, env } from "@huggingface/transformers";
import fs from "node:fs";
import path from "node:path";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const IDX = path.join("public", "idx");
env.allowRemoteModels = true;

const docs = JSON.parse(fs.readFileSync(path.join(IDX, "docs.json"), "utf8"));
const models = ["gemma-2-2b", "llama3.1-8b"];
const texts = [];
for (const m of models) for (const [, , d] of docs[m]) texts.push(d);
console.log(`embedding ${texts.length.toLocaleString()} descriptions with ${MODEL}`);

const extract = await pipeline("feature-extraction", MODEL, { dtype: "q8" });

const DIMS = 384;
const out = new Float32Array(texts.length * DIMS);
const BATCH = 256;
const t0 = Date.now();
for (let i = 0; i < texts.length; i += BATCH) {
  const batch = texts.slice(i, i + BATCH);
  const t = await extract(batch, { pooling: "mean", normalize: true });
  out.set(t.data, i * DIMS);
  if ((i / BATCH) % 20 === 0) {
    const done = Math.min(i + BATCH, texts.length);
    const rate = done / ((Date.now() - t0) / 1000);
    process.stdout.write(
      `  ${done.toLocaleString()}/${texts.length.toLocaleString()}  ${rate.toFixed(0)}/s  eta ${Math.round((texts.length - done) / rate)}s\n`
    );
  }
}
fs.writeFileSync(path.join(IDX, "vecs.f32"), Buffer.from(out.buffer));
console.log(`wrote vecs.f32  ${(out.byteLength / 1e6).toFixed(1)} MB in ${Math.round((Date.now() - t0) / 1000)}s`);
