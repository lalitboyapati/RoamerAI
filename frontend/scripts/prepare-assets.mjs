/**
 * Copy the onnxruntime WebAssembly backend into public/ before a build.
 *
 * It is already a dependency, so committing a 24 MB duplicate would be silly —
 * but it has to be served from this origin, because onnxruntime otherwise
 * fetches it from a public CDN at runtime and every search would depend on
 * someone else's uptime.
 */
import fs from "node:fs";
import path from "node:path";

const FILES = ["ort-wasm-simd-threaded.asyncify.wasm", "ort-wasm-simd-threaded.asyncify.mjs"];
const from = path.join("node_modules", "onnxruntime-web", "dist");
const to = path.join("public", "ort");

fs.mkdirSync(to, { recursive: true });
for (const f of FILES) {
  const src = path.join(from, f);
  if (!fs.existsSync(src)) {
    console.error(`prepare-assets: missing ${src} — is onnxruntime-web installed?`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(to, f));
  console.log(`prepare-assets: ${f} ${(fs.statSync(src).size / 1e6).toFixed(1)} MB`);
}
