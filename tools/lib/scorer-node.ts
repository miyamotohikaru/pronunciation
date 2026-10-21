/**
 * The scorer in Node, for build scripts. Uses onnxruntime-node when it is installed (in
 * tools/scoring-tests, ~10× faster), else the app's own onnxruntime-web (WASM in Node, 4
 * threads). The shipped model computes in fp32, so both give the same scores (~1e-4).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createOrtBackend, type OrtModuleLike } from "../../src/engine/scoring/backend-ort.ts";
import { createScorer, type Scorer } from "../../src/engine/scoring/engine.ts";
import type { MelFilterBank, ModelMeta, RegressorJson, ScorerAssets } from "../../src/engine/scoring/types.ts";

export const ROOT = new URL("../../", import.meta.url).pathname;
/** the default model (same as the app: src/engine/scoring/client.ts DEFAULT_MODEL_URL) */
export const MODEL_DIR = join(ROOT, "public/models/student-ipa");

const json = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

export function loadAssetsFs(dir = MODEL_DIR): ScorerAssets {
  const meta = json<ModelMeta>(join(dir, "meta.json"));
  return {
    meta,
    regressor: json<RegressorJson>(join(dir, meta.files.regressor)),
    melFilters: json<MelFilterBank>(join(dir, meta.files.melFilters)),
  };
}

export async function makeNodeScorer(opts: { dir?: string; runtime?: "auto" | "node" | "web"; threads?: number } = {}): Promise<{ scorer: Scorer; runtime: string }> {
  const dir = opts.dir ?? MODEL_DIR;
  const assets = loadAssetsFs(dir);
  const key = assets.meta.files.defaultOnnx;
  const bytes = new Uint8Array(readFileSync(join(dir, assets.meta.files.onnx[key])));
  const extra = assets.meta.files.sessionConfig?.[key];
  const nodePath = join(ROOT, "tools/scoring-tests/node_modules/onnxruntime-node/dist/index.js");
  const useNode = opts.runtime === "node" || (opts.runtime !== "web" && existsSync(nodePath));
  let ort: OrtModuleLike;
  if (useNode) {
    ort = (await import(nodePath)) as unknown as OrtModuleLike;
  } else {
    ort = (await import("onnxruntime-web")) as unknown as OrtModuleLike;
    if (ort.env?.wasm) ort.env.wasm.numThreads = opts.threads ?? 4;
  }
  const backend = await createOrtBackend(ort, bytes, {
    inputName: assets.meta.onnx.input,
    outputName: assets.meta.onnx.output,
    nMels: assets.meta.frontEnd.nMels,
    executionProviders: [useNode ? "cpu" : "wasm"],
    sessionOptions: extra ? { extra } : {},
  });
  return { scorer: createScorer(assets, backend), runtime: useNode ? "onnxruntime-node" : "onnxruntime-web (wasm)" };
}
