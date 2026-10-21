/**
 * Copies the pinned onnxruntime-web runtime (this folder's node_modules) into
 * public/models/ort/, where src/engine/scoring/worker.ts loads it from (self-hosted: the
 * app is cross-origin isolated).
 *   node copy-ort-web.mjs [--wasm-only]
 * ort.wasm.bundle.min.mjs + ort-wasm-simd-threaded.wasm          WASM (CPU) only, 14 MB
 * ort.webgpu.bundle.min.mjs + ort-wasm-simd-threaded.asyncify.wasm  WebGPU + WASM, 26 MB
 */
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL("./", import.meta.url).pathname;
const SRC = join(HERE, "node_modules/onnxruntime-web/dist");
const DST = join(HERE, "../../public/models/ort");
const version = JSON.parse(readFileSync(join(HERE, "node_modules/onnxruntime-web/package.json"), "utf8")).version;
const files = ["ort.wasm.bundle.min.mjs", "ort-wasm-simd-threaded.wasm"];
if (!process.argv.includes("--wasm-only")) files.push("ort.webgpu.bundle.min.mjs", "ort-wasm-simd-threaded.asyncify.wasm");
mkdirSync(DST, { recursive: true });
for (const f of files) {
  copyFileSync(join(SRC, f), join(DST, f));
  console.log(`${f.padEnd(40)} ${(statSync(join(DST, f)).size / 1e6).toFixed(2)} MB`);
}
console.log(`onnxruntime-web ${version} -> ${DST}`);
