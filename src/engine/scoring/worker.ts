/**
 * Module Web Worker that owns the scorer (use it through client.ts). Framework-free.
 * onnxruntime-web is imported at run time from our own origin (public/models/ort/, copied
 * from node_modules by tools/lib/copy-ort-web.mjs), so the bundler never touches ORT.
 *
 * in : { type: "init", modelUrl, ortUrl, providers?, onnx?, threads? }
 *      { type: "score", id, audio: Float32Array (16 kHz mono, transferred), words, options? }
 * out: { type: "progress", phase, loaded?, total?, cached? }
 *      { type: "ready", backend, loadMs }
 *      { type: "result", id, result } | { type: "error", id?, message } | { type: "log", message }
 */
import type { ScoreOptions, TargetWord } from "./types.ts";
import { createScorer, type Scorer } from "./engine.ts";
import { createOrtBackend, type OrtModuleLike } from "./backend-ort.ts";
import { fetchCached, loadAssets, loadModelBytes } from "./assets.ts";

export type WorkerInit = {
  type: "init";
  /** folder with meta.json, e.g. "/models/student-ipa/" */
  modelUrl: string;
  /** folder with the onnxruntime-web bundles + .wasm, e.g. "/models/ort/" */
  ortUrl: string;
  /** default: ["webgpu", "wasm"] when navigator.gpu exists, else ["wasm"] */
  providers?: string[];
  /** key of meta.files.onnx (default: meta.files.defaultOnnx) */
  onnx?: string;
  /** WASM threads (needs crossOriginIsolated). Default min(4, cores) */
  threads?: number;
};
export type WorkerScore = { type: "score"; id: number; audio: Float32Array; words: TargetWord[]; options?: ScoreOptions };
export type WorkerProgress = { type: "progress"; phase: "runtime" | "assets" | "model" | "session"; loaded?: number; total?: number; cached?: boolean };

type WorkerScope = {
  postMessage(msg: unknown): void;
  onmessage: ((e: { data: WorkerInit | WorkerScore }) => void) | null;
  navigator?: { gpu?: unknown; hardwareConcurrency?: number };
  crossOriginIsolated?: boolean;
};
const scope = globalThis as unknown as WorkerScope;
const post = (msg: unknown) => scope.postMessage(msg);

/** progress at most every 150 ms per phase (plus the last one), so the page is not flooded */
const lastProgress = new Map<string, number>();
function progress(p: WorkerProgress): void {
  const t = performance.now();
  const done = p.loaded !== undefined && p.total !== undefined && p.loaded >= p.total;
  if (!done && t - (lastProgress.get(p.phase) ?? -Infinity) < 150) return;
  lastProgress.set(p.phase, t);
  post(p);
}

let scorer: Scorer | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** the .wasm each bundle loads (its glue for the WASM threads is fetched by ORT itself) */
const WASM_OF: Record<string, string> = {
  "ort.webgpu.bundle.min.mjs": "ort-wasm-simd-threaded.asyncify.wasm",
  "ort.wasm.bundle.min.mjs": "ort-wasm-simd-threaded.wasm",
};

/**
 * Imports an ORT bundle from our origin and hands it the .wasm from the Cache Storage API
 * (env.wasm.wasmBinary), so a second visit loads the runtime without the network.
 */
async function importOrt(base: string, bundle: string, threads: number | undefined): Promise<OrtModuleLike> {
  const ort = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ base + bundle)) as OrtModuleLike;
  if (ort.env?.wasm) {
    ort.env.wasm.wasmPaths = base;
    ort.env.wasm.numThreads = scope.crossOriginIsolated ? Math.max(1, Math.min(threads ?? 4, scope.navigator?.hardwareConcurrency ?? 4)) : 1;
    ort.env.wasm.proxy = false;
    try {
      const bin = await fetchCached(base + WASM_OF[bundle], ort.env.versions?.web, (p) =>
        progress({ type: "progress", phase: "runtime", loaded: p.loaded, total: p.total, cached: p.cached }),
      );
      ort.env.wasm.wasmBinary = bin;
    } catch {
      // let ORT fetch it itself
    }
  }
  return ort;
}

async function init(msg: WorkerInit): Promise<void> {
  const t0 = performance.now();
  const base = msg.ortUrl.endsWith("/") ? msg.ortUrl : msg.ortUrl + "/";
  const providers = msg.providers ?? (scope.navigator?.gpu ? ["webgpu", "wasm"] : ["wasm"]);
  // the WebGPU bundle also runs the wasm EP; the plain wasm bundle is half the size
  const gpuFirst = providers.includes("webgpu");
  progress({ type: "progress", phase: "assets" });
  // model and runtime download in parallel
  const ortP = importOrt(base, gpuFirst ? "ort.webgpu.bundle.min.mjs" : "ort.wasm.bundle.min.mjs", msg.threads);
  ortP.catch(() => undefined);
  const assets = await loadAssets(msg.modelUrl);
  const variant = msg.onnx ?? assets.meta.files.defaultOnnx;
  const bytes = await loadModelBytes(msg.modelUrl, assets.meta, variant, (p) =>
    progress({ type: "progress", phase: "model", loaded: p.loaded, total: p.total, cached: p.cached }),
  );
  const extra = assets.meta.files.sessionConfig?.[variant];
  const options = {
    inputName: assets.meta.onnx.input,
    outputName: assets.meta.onnx.output,
    nMels: assets.meta.frontEnd.nMels,
    sessionOptions: extra ? { extra } : undefined,
    onLog: (m: string) => post({ type: "log", message: m }),
  };
  let backend;
  try {
    const ort = await ortP;
    progress({ type: "progress", phase: "session" });
    backend = await createOrtBackend(ort, bytes, { ...options, executionProviders: providers });
  } catch (e) {
    if (!gpuFirst) throw e;
    post({ type: "log", message: `webgpu bundle failed (${e instanceof Error ? e.message : String(e)}), using wasm` });
    const ort = await importOrt(base, "ort.wasm.bundle.min.mjs", msg.threads);
    backend = await createOrtBackend(ort, bytes, { ...options, executionProviders: ["wasm"] });
  }
  scorer = createScorer(assets, backend);
  post({ type: "ready", backend: backend.name, loadMs: Math.round(performance.now() - t0) });
}

scope.onmessage = (e) => {
  const msg = e.data;
  queue = queue.then(async () => {
    try {
      if (msg.type === "init") await init(msg);
      else if (msg.type === "score") {
        if (!scorer) throw new Error("scorer not loaded");
        const result = await scorer.score({ audio: msg.audio, words: msg.words }, msg.options);
        post({ type: "result", id: msg.id, result });
      }
    } catch (err) {
      post({ type: "error", id: msg.type === "score" ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
    }
  });
};
