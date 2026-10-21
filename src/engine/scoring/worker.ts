/**
 * Module Web Worker that owns the scorer. Framework-free; the page talks to it with
 * postMessage. onnxruntime-web is loaded at run time from a URL (self-hosted, see
 * README), so nothing here is bundled with ORT.
 *
 *   const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
 *   w.postMessage({ type: "init", modelUrl: "/models/whisper-phoneme/", ortUrl: "/models/ort/" });
 *   w.postMessage({ type: "score", id: 1, audio, words }, [audio.buffer]);
 *
 * in : { type: "init", modelUrl, ortUrl, providers?, onnx?, threads? }
 *      { type: "score", id, audio: Float32Array (16 kHz mono), words: TargetWord[], options? }
 * out: { type: "ready", backend, loadMs } | { type: "result", id, result }
 *      { type: "error", id?, message } | { type: "log", message }
 */
import type { ScoreOptions, TargetWord } from "./types.ts";
import { createScorer, type Scorer } from "./engine.ts";
import { createOrtBackend, type OrtModuleLike } from "./backend-ort.ts";
import { loadAssets, loadModelBytes } from "./assets.ts";

type InitMsg = {
  type: "init";
  /** folder with meta.json, e.g. "/models/whisper-phoneme/" */
  modelUrl: string;
  /** folder with the onnxruntime-web bundles + .wasm, e.g. "/models/ort/" */
  ortUrl: string;
  /** default: ["webgpu", "wasm"] when navigator.gpu exists, else ["wasm"] */
  providers?: string[];
  /** key of meta.files.onnx (default: meta.files.defaultOnnx) */
  onnx?: string;
  threads?: number;
};
type ScoreMsg = { type: "score"; id: number; audio: Float32Array; words: TargetWord[]; options?: ScoreOptions };

type WorkerScope = {
  postMessage(msg: unknown): void;
  onmessage: ((e: { data: InitMsg | ScoreMsg }) => void) | null;
  navigator?: { gpu?: unknown; hardwareConcurrency?: number };
  crossOriginIsolated?: boolean;
};
const scope = globalThis as unknown as WorkerScope;

let scorer: Scorer | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function init(msg: InitMsg): Promise<void> {
  const t0 = performance.now();
  const hasGpu = !!scope.navigator?.gpu;
  const providers = msg.providers ?? (hasGpu ? ["webgpu", "wasm"] : ["wasm"]);
  const base = msg.ortUrl.endsWith("/") ? msg.ortUrl : msg.ortUrl + "/";
  // the WebGPU bundle also runs the wasm EP; the plain wasm bundle is half the size
  const bundle = providers.includes("webgpu") ? "ort.webgpu.bundle.min.mjs" : "ort.wasm.bundle.min.mjs";
  const ort = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ base + bundle)) as OrtModuleLike;
  if (ort.env?.wasm) {
    ort.env.wasm.wasmPaths = base;
    ort.env.wasm.numThreads = scope.crossOriginIsolated ? Math.max(1, Math.min(msg.threads ?? 4, scope.navigator?.hardwareConcurrency ?? 4)) : 1;
    ort.env.wasm.proxy = false;
  }
  const assets = await loadAssets(msg.modelUrl);
  const bytes = await loadModelBytes(msg.modelUrl, assets.meta, msg.onnx);
  const backend = await createOrtBackend(ort, bytes, {
    inputName: assets.meta.onnx.input,
    outputName: assets.meta.onnx.output,
    nMels: assets.meta.frontEnd.nMels,
    executionProviders: providers,
    onLog: (m) => scope.postMessage({ type: "log", message: m }),
  });
  scorer = createScorer(assets, backend);
  scope.postMessage({ type: "ready", backend: backend.name, loadMs: Math.round(performance.now() - t0) });
}

scope.onmessage = (e) => {
  const msg = e.data;
  queue = queue.then(async () => {
    try {
      if (msg.type === "init") await init(msg);
      else if (msg.type === "score") {
        if (!scorer) throw new Error("not initialized");
        const result = await scorer.score({ audio: msg.audio, words: msg.words }, msg.options);
        scope.postMessage({ type: "result", id: msg.id, result });
      }
    } catch (err) {
      scope.postMessage({ type: "error", id: msg.type === "score" ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
    }
  });
};
