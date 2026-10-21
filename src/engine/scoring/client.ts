/**
 * Main-thread wrapper around the scoring worker (worker.ts). Framework-free.
 *
 *   const scoring = createScoringClient();
 *   await scoring.load((p) => console.log(p.phase, p.loaded, p.total));   // once per page
 *   const result = await scoring.score(take.pcm16k, item.words, { ...item.scoring, alignTo: ref.phones });
 *
 * The model (24 MB) is kept in the Cache Storage API by the worker; WebGPU is tried first
 * when the browser has it and falls back to WASM (threads when crossOriginIsolated).
 */
import type { ScoreOptions, ScoreResult, TargetWord } from "./types.ts";
import type { WorkerProgress } from "./worker.ts";

export type ScoringProgress = Omit<WorkerProgress, "type">;

export type ScoringClientOptions = {
  /** default "/models/whisper-phoneme/" */
  modelUrl?: string;
  /** default "/models/ort/" */
  ortUrl?: string;
  /** default: ["webgpu", "wasm"] if the browser has WebGPU, else ["wasm"] */
  providers?: string[];
  threads?: number;
};

export type ScoringClient = {
  /** Starts the worker, downloads (or reads the cached) model, warms it up. Idempotent. */
  load(onProgress?: (p: ScoringProgress) => void): Promise<{ backend: string; loadMs: number }>;
  /** pcm16k is copied (the caller keeps its array). Words: TargetWord[] (ItemWord fits). */
  score(pcm16k: Float32Array, words: TargetWord[], options?: ScoreOptions): Promise<ScoreResult>;
  /** "webgpu" | "wasm" once loaded */
  readonly backend: string | null;
  dispose(): void;
};

type Out =
  | ({ type: "progress" } & ScoringProgress)
  | { type: "ready"; backend: string; loadMs: number }
  | { type: "result"; id: number; result: ScoreResult }
  | { type: "error"; id?: number; message: string }
  | { type: "log"; message: string };

export function createScoringClient(opts: ScoringClientOptions = {}): ScoringClient {
  let worker: Worker | null = null;
  let loading: Promise<{ backend: string; loadMs: number }> | null = null;
  let backend: string | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (r: ScoreResult) => void; reject: (e: Error) => void }>();
  let progressCb: ((p: ScoringProgress) => void) | undefined;

  function start(): Promise<{ backend: string; loadMs: number }> {
    return new Promise((resolve, reject) => {
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<Out>) => {
        const m = e.data;
        if (m.type === "progress") progressCb?.({ phase: m.phase, loaded: m.loaded, total: m.total, cached: m.cached });
        else if (m.type === "ready") {
          backend = m.backend;
          resolve({ backend: m.backend, loadMs: m.loadMs });
        } else if (m.type === "result") {
          pending.get(m.id)?.resolve(m.result);
          pending.delete(m.id);
        } else if (m.type === "error") {
          if (m.id === undefined) reject(new Error(m.message));
          else {
            pending.get(m.id)?.reject(new Error(m.message));
            pending.delete(m.id);
          }
        } else if (m.type === "log" && typeof console !== "undefined") console.debug(`[scoring] ${m.message}`);
      };
      worker.onerror = (e) => reject(new Error(e.message || "scoring worker failed to start"));
      worker.postMessage({
        type: "init",
        modelUrl: opts.modelUrl ?? "/models/whisper-phoneme/",
        ortUrl: opts.ortUrl ?? "/models/ort/",
        providers: opts.providers,
        threads: opts.threads,
      });
    });
  }

  return {
    load(onProgress) {
      progressCb = onProgress;
      if (!loading) {
        loading = start();
        loading.catch(() => {
          loading = null; // allow a retry
          worker?.terminate();
          worker = null;
        });
      }
      return loading;
    },
    async score(pcm16k, words, options) {
      await (loading ?? this.load());
      const id = nextId++;
      const audio = pcm16k.slice();
      return new Promise<ScoreResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker!.postMessage({ type: "score", id, audio, words: words.map((w) => ({ text: w.text, variants: w.variants })), options }, [audio.buffer]);
      });
    },
    get backend() {
      return backend;
    },
    dispose() {
      worker?.terminate();
      worker = null;
      loading = null;
      for (const p of pending.values()) p.reject(new Error("disposed"));
      pending.clear();
    },
  };
}
