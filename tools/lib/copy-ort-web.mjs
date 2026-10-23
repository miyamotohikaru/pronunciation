/**
 * Copies the onnxruntime-web runtime the scoring worker loads (src/engine/scoring/worker.ts)
 * from node_modules into public/models/ort/ (gitignored). Runs as `predev` / `prebuild`;
 * skips files that are already identical, so it costs nothing on a warm checkout.
 *   ort.wasm.bundle.min.mjs + ort-wasm-simd-threaded.{mjs,wasm}            browsers without WebGPU
 *   ort.webgpu.bundle.min.mjs + ort-wasm-simd-threaded.asyncify.{mjs,wasm}  WebGPU (+ its WASM EP)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const require = createRequire(join(ROOT, "package.json"));
// the package exports its .wasm files (not package.json): resolve one to find dist/
const SRC = dirname(require.resolve("onnxruntime-web/ort-wasm-simd-threaded.wasm"));
const pkgJson = join(SRC, "..", "package.json");
const DST = join(ROOT, "public/models/ort");
const FILES = [
  "ort.wasm.bundle.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm",
  "ort.webgpu.bundle.min.mjs", "ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm",
];

const version = JSON.parse(readFileSync(pkgJson, "utf8")).version;
mkdirSync(DST, { recursive: true });
let copied = 0;
for (const f of FILES) {
  const from = join(SRC, f);
  const to = join(DST, f);
  const a = statSync(from);
  if (existsSync(to)) {
    const b = statSync(to);
    if (b.size === a.size && b.mtimeMs >= a.mtimeMs) continue;
  }
  copyFileSync(from, to);
  copied++;
}
console.log(`onnxruntime-web ${version}: ${copied ? `copied ${copied} file(s)` : "up to date"} -> public/models/ort/`);
