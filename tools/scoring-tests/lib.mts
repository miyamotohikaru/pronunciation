/** Shared helpers for the Node tests of src/engine/scoring. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as ort from "onnxruntime-node";
import { createOrtBackend, createScorer, misakiToArpabet, type Scorer } from "../../src/engine/scoring/index.ts";
import type { MelFilterBank, ModelMeta, RegressorJson, TargetWord } from "../../src/engine/scoring/types.ts";

export const ROOT = new URL("../../", import.meta.url).pathname;
export const MODEL_DIR = join(ROOT, "public/models/whisper-phoneme");
export const WORK = join(ROOT, ".work");

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** 16-bit PCM or 32-bit float RIFF WAV -> Float32Array (-1..1), mono expected. */
export function readWav(path: string): { audio: Float32Array; sampleRate: number } {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error(`not a WAV: ${path}`);
  let off = 12;
  let fmt = 0;
  let channels = 1;
  let sampleRate = 16000;
  let bits = 16;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = b.readUInt16LE(body);
      channels = b.readUInt16LE(body + 2);
      sampleRate = b.readUInt32LE(body + 4);
      bits = b.readUInt16LE(body + 14);
    } else if (id === "data") {
      const n = Math.floor(size / (bits / 8) / channels);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * (bits / 8);
          acc += fmt === 3 ? b.readFloatLE(p) : b.readInt16LE(p) / 32768;
        }
        out[i] = acc / channels;
      }
      return { audio: out, sampleRate };
    }
    off = body + size + (size % 2);
  }
  throw new Error(`no data chunk: ${path}`);
}

export function loadAssetsFs(dir = MODEL_DIR) {
  const meta = readJson<ModelMeta>(join(dir, "meta.json"));
  return {
    meta,
    regressor: readJson<RegressorJson>(join(dir, meta.files.regressor)),
    melFilters: readJson<MelFilterBank>(join(dir, meta.files.melFilters)),
  };
}

export async function makeScorer(opts: { onnx?: string; threads?: number; dir?: string } = {}): Promise<Scorer> {
  const assets = loadAssetsFs(opts.dir);
  const file = opts.onnx ?? join(opts.dir ?? MODEL_DIR, assets.meta.files.onnx[assets.meta.files.defaultOnnx]);
  const backend = await createOrtBackend(ort as never, file, {
    inputName: assets.meta.onnx.input,
    outputName: assets.meta.onnx.output,
    nMels: assets.meta.frontEnd.nMels,
    executionProviders: ["cpu"],
    sessionOptions: opts.threads ? { intraOpNumThreads: opts.threads } : {},
  });
  return createScorer(assets, backend);
}

// ------------------------------------------------------------------ lexicon

let cmu: Map<string, string[][]> | null = null;
export function cmudict(): Map<string, string[][]> {
  if (cmu) return cmu;
  cmu = new Map();
  for (const line of readFileSync(join(WORK, "cmudict.dict"), "utf8").split("\n")) {
    const parts = line.split("#")[0].trim().split(/\s+/);
    if (parts.length < 2) continue;
    const w = parts[0].replace(/\(\d+\)$/, "");
    const list = cmu.get(w) ?? [];
    list.push(parts.slice(1));
    cmu.set(w, list);
  }
  return cmu;
}

/** Words of a text for lookup: lower case, keeps apostrophes. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

/** CMUdict variants of a chunk ("check it out" -> every combination, capped). */
export function cmuVariants(chunk: string, cap = 8): string[][] {
  let acc: string[][] = [[]];
  for (const w of tokenize(chunk)) {
    const vs = cmudict().get(w);
    if (!vs) throw new Error(`not in cmudict: ${w}`);
    const next: string[][] = [];
    for (const a of acc) for (const v of vs) if (next.length < cap) next.push(a.concat(v));
    acc = next;
  }
  return acc;
}

export type KokoroClip = { id: string; text: string; words: { text: string; phonemes: string; start: number; end: number }[] };

/** Targets from the Kokoro reference JSONs: misaki variants first, then CMUdict ones. */
export function targetsFromKokoro(jsonPaths: string[]): TargetWord[] {
  const clips = jsonPaths.filter(existsSync).map((p) => readJson<KokoroClip>(p));
  if (!clips.length) throw new Error("no Kokoro json");
  return clips[0].words.map((w, i) => {
    const seen = new Set<string>();
    const variants: string[] = [];
    const add = (v: string[]) => {
      const k = v.join(" ");
      if (v.length && !seen.has(k)) {
        seen.add(k);
        variants.push(k);
      }
    };
    for (const c of clips) if (c.words[i]?.text === w.text) add(misakiToArpabet(c.words[i].phonemes));
    for (const v of cmuVariants(w.text)) add(v);
    return { text: w.text, variants };
  });
}

/** Targets from CMUdict only. */
export function targetsFromText(text: string): TargetWord[] {
  return tokenize(text).map((w) => ({ text: w, variants: cmuVariants(w).map((v) => v.join(" ")) }));
}

// ------------------------------------------------------------------ build-time variants

import { deriveVariants, type LearnedVariant } from "../../src/engine/scoring/reference.ts";
import { addConnectedSpeech } from "../../src/engine/scoring/connected.ts";
import { writeFileSync, mkdirSync } from "node:fs";

const REF_VOICES = ["af_heart", "am_michael"];

/** Kokoro reference takes of a sentence (normal + slow, both voices). */
export function referenceTakes(sentence: string): { name: string; audio: Float32Array }[] {
  const out: { name: string; audio: Float32Array }[] = [];
  for (const v of REF_VOICES)
    for (const suffix of [".16k.wav", ".slow.16k.wav"]) {
      const p = join(WORK, "tts", v, sentence + suffix);
      if (existsSync(p)) out.push({ name: `${v}/${sentence}${suffix}`, audio: readWav(p).audio });
    }
  return out;
}

/**
 * Targets as the content build would ship them: misaki + CMUdict variants, plus the
 * variants learned from the reference takes (deriveVariants). Cached in .work/eval.
 */
export async function shippedTargets(scorer: Scorer, sentence: string, jsons: string[]): Promise<{ words: TargetWord[]; learned: LearnedVariant[] }> {
  const cacheDir = join(WORK, "eval", "targets");
  const key = join(cacheDir, `${sentence}.json`);
  const base = targetsFromKokoro(jsons);
  if (existsSync(key)) {
    const c = readJson<{ base: TargetWord[]; words: TargetWord[]; learned: LearnedVariant[] }>(key);
    if (JSON.stringify(c.base) === JSON.stringify(base)) return c;
  }
  const r = await deriveVariants(scorer, addConnectedSpeech(base), referenceTakes(sentence));
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(key, JSON.stringify({ base, ...r }, null, 1));
  return r;
}
