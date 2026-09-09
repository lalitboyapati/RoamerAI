/**
 * Build the static search index, one directory per model.
 *
 * Reads the deep sample written by pull_data.py, embeds every description with
 * the exact quantised model the browser runs, quantises to int8 and writes each
 * model's files separately so a visitor downloads only the models they picked.
 *
 * Typesense is not involved. It was, when the vectors came from its server-side
 * embedder; now that both sides use the same ONNX file there is nothing left
 * for it to do in this path.
 *
 *   node scripts/build-index.mjs                       # every model with data
 *   node scripts/build-index.mjs deepseek-r1-distill-llama-8b
 */
import { pipeline, env } from "@huggingface/transformers";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIMS = 384;
const DATA = path.join("..", "data");
const IDX = path.join("public", "idx");
env.allowRemoteModels = true;

const wanted = process.argv.slice(2);
const files = fs
  .readdirSync(DATA)
  .filter((f) => f.endsWith(".deep.jsonl"))
  .map((f) => f.replace(".deep.jsonl", ""))
  .filter((m) => !wanted.length || wanted.includes(m));
if (!files.length) {
  console.error(`no *.deep.jsonl in ${DATA}${wanted.length ? ` matching ${wanted}` : ""}`);
  process.exit(1);
}

// model facts come from whatever pull_data.py last wrote, merged with what is
// already published, so building one model never drops the others
const merged = {};
for (const p of [path.join("public", "manifest.json"), path.join(DATA, "manifest.json")]) {
  if (fs.existsSync(p)) Object.assign(merged, JSON.parse(fs.readFileSync(p, "utf8")).models);
}

const extract = await pipeline("feature-extraction", MODEL, { dtype: "q8" });

const catalogPath = path.join(IDX, "catalog.json");
const catalog = fs.existsSync(catalogPath)
  ? JSON.parse(fs.readFileSync(catalogPath, "utf8"))
  : { version: 2, embedModel: MODEL, dims: DIMS, models: {} };
catalog.version = 2;
catalog.embedModel = MODEL;
catalog.dims = DIMS;

for (const model of files) {
  const rows = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(DATA, `${model}.deep.jsonl`)),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const d = JSON.parse(line);
    if (d.description) rows.push([d.layer, d.index, d.description]);
  }
  rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  console.log(`${model}: ${rows.length.toLocaleString()} descriptions`);

  const out = new Float32Array(rows.length * DIMS);
  const BATCH = 256;
  const t0 = Date.now();
  for (let i = 0; i < rows.length; i += BATCH) {
    const t = await extract(rows.slice(i, i + BATCH).map((r) => r[2]), {
      pooling: "mean",
      normalize: true,
    });
    out.set(t.data, i * DIMS);
    if ((i / BATCH) % 40 === 0) {
      const done = Math.min(i + BATCH, rows.length);
      process.stdout.write(`  ${done.toLocaleString()}/${rows.length.toLocaleString()}\r`);
    }
  }

  // one scale per model keeps each file independent of the others
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]));
  const scale = max / 127;
  const q = new Int8Array(out.length);
  for (let i = 0; i < out.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(out[i] / scale)));

  const dir = path.join(IDX, model);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "docs.json"), JSON.stringify(rows));
  fs.writeFileSync(path.join(dir, "vecs.i8"), Buffer.from(q.buffer));

  const m = merged[model] ?? {};
  const perLayer = {};
  for (const [l] of rows) perLayer[l] = (perLayer[l] ?? 0) + 1;
  catalog.models[model] = {
    display: m.display ?? model,
    sourceSet: m.source_set ?? "",
    nLayers: m.n_layers ?? Math.max(...rows.map((r) => r[0])) + 1,
    width: m.width ?? 0,
    count: rows.length,
    perLayer,
    scale,
    bytes: rows.length * DIMS + fs.statSync(path.join(dir, "docs.json")).size,
  };
  console.log(
    `  ${((rows.length * DIMS) / 1e6).toFixed(1)} MB vectors, ` +
      `${(fs.statSync(path.join(dir, "docs.json")).size / 1e6).toFixed(1)} MB text, ` +
      `${Math.round((Date.now() - t0) / 1000)}s`
  );
}

fs.mkdirSync(IDX, { recursive: true });
fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
console.log("\ncatalog:");
for (const [id, m] of Object.entries(catalog.models)) {
  console.log(`  ${id.padEnd(30)} ${String(m.nLayers).padStart(2)} layers  ${m.count.toLocaleString().padStart(7)} features`);
}
