/**
 * ONNX Runtime backend. The ORT module is passed in, so this file imports neither package:
 *   browser:  const ort = await import(".../ort.webgpu.bundle.min.mjs")  (onnxruntime-web)
 *   node:     import * as ort from "onnxruntime-node"
 * Execution providers are tried in order (default: webgpu, then wasm in a browser; cpu
 * in Node). A provider counts as working only after a warm-up run succeeds.
 */
import type { AcousticBackend, LogProbs } from "./types.ts";

/** The subset of the onnxruntime-web / onnxruntime-node API used here. */
export type OrtTensorLike = { data: unknown; dims: readonly number[]; dispose?: () => void };
export type OrtSessionLike = {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
  release?: () => Promise<void>;
};
export type OrtModuleLike = {
  InferenceSession: { create(model: Uint8Array | string, options?: Record<string, unknown>): Promise<OrtSessionLike> };
  Tensor: new (type: "float32", data: Float32Array, dims: readonly number[]) => unknown;
  env?: {
    wasm?: { numThreads?: number; wasmPaths?: unknown; proxy?: boolean };
    logLevel?: string;
  };
};

export type OrtBackendOptions = {
  inputName: string;
  outputName: string;
  nMels: number;
  /** e.g. ["webgpu", "wasm"] (browser) or ["cpu"] (node). */
  executionProviders: string[];
  /** Extra session options (graphOptimizationLevel, intraOpNumThreads ...). */
  sessionOptions?: Record<string, unknown>;
  /** Mel frames of the warm-up run (also compiles WebGPU shaders). 0 = skip. */
  warmupFrames?: number;
  onLog?: (msg: string) => void;
};

export async function createOrtBackend(
  ort: OrtModuleLike,
  model: Uint8Array | string,
  opts: OrtBackendOptions,
): Promise<AcousticBackend> {
  const errors: string[] = [];
  for (const ep of opts.executionProviders) {
    let session: OrtSessionLike | null = null;
    try {
      session = await ort.InferenceSession.create(model, {
        executionProviders: [ep],
        graphOptimizationLevel: "all",
        ...opts.sessionOptions,
      });
      const backend = wrap(ort, session, ep, opts);
      const warm = opts.warmupFrames ?? 200;
      if (warm > 0) await backend.run(new Float32Array(opts.nMels * warm), opts.nMels, warm);
      opts.onLog?.(`onnxruntime: using ${ep}`);
      return backend;
    } catch (e) {
      errors.push(`${ep}: ${e instanceof Error ? e.message : String(e)}`);
      opts.onLog?.(`onnxruntime: ${ep} failed, trying the next provider`);
      try {
        await session?.release?.();
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error(`no execution provider worked (${errors.join("; ")})`);
}

function wrap(ort: OrtModuleLike, session: OrtSessionLike, ep: string, opts: OrtBackendOptions): AcousticBackend {
  return {
    name: ep,
    async run(mel: Float32Array, nMels: number, nFrames: number): Promise<LogProbs> {
      const input = new ort.Tensor("float32", mel, [1, nMels, nFrames]);
      const out = await session.run({ [opts.inputName]: input });
      const t = out[opts.outputName];
      const data = t.data as Float32Array;
      const lp: LogProbs = { data: new Float32Array(data), frames: t.dims[1], vocabSize: t.dims[2] };
      t.dispose?.();
      return lp;
    },
    async dispose() {
      await session.release?.();
    },
  };
}
