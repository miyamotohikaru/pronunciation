/**
 * Latency of the whole scorer in Node (onnxruntime-node, CPU) for ~3 s and ~8 s takes.
 * Takes are Kokoro af_heart sentences glued together (targets glued the same way).
 *   node bench.mts [onnx-file ...] [--threads N] [--runs N]
 */
import { join, basename } from "node:path";
import { makeScorer, readWav, shippedTargets, WORK } from "./lib.mts";
import { kokoroJsons } from "./cases.mts";
import type { TargetWord } from "../../src/engine/scoring/types.ts";

const args = process.argv.slice(2);
const opt = (k: string, d: number) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
const threads = opt("--threads", 0);
const runs = opt("--runs", 10);
const files = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));

const SETS: Record<string, string[]> = {
  "3s": ["t01_rice", "t02_think", "t03_very"],
  "8s": ["t01_rice", "t02_think", "t03_very", "t04_street", "t05_want", "t06_gonna", "t07_again"],
};

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

for (const onnx of files.length ? files : [undefined]) {
  const scorer = await makeScorer({ onnx, threads: threads || undefined });
  console.log(`\n${onnx ? basename(onnx) : "default (meta.json)"}  threads=${threads || "default"}`);
  for (const [name, ids] of Object.entries(SETS)) {
    const parts: Float32Array[] = [];
    const words: TargetWord[] = [];
    for (const id of ids) {
      parts.push(readWav(join(WORK, "tts", "af_heart", `${id}.16k.wav`)).audio);
      words.push(...(await shippedTargets(scorer, id, kokoroJsons(id))).words);
    }
    const audio = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
    let off = 0;
    for (const p of parts) {
      audio.set(p, off);
      off += p.length;
    }
    await scorer.score({ audio, words }); // warm-up
    const t: { mel: number[]; model: number[]; align: number[]; total: number[] } = { mel: [], model: [], align: [], total: [] };
    let last = 0;
    for (let i = 0; i < runs; i++) {
      const r = await scorer.score({ audio, words });
      t.mel.push(r.timing.mel);
      t.model.push(r.timing.model);
      t.align.push(r.timing.align);
      t.total.push(r.timing.total);
      last = r.sounds;
    }
    console.log(
      `  ${name} (${(audio.length / 16000).toFixed(2)} s, ${words.length} words): total ${median(t.total).toFixed(1)} ms  = mel ${median(t.mel).toFixed(1)} + model ${median(t.model).toFixed(1)} + align/diagnosis ${median(t.align).toFixed(1)}  (sounds ${last})`,
    );
  }
  await scorer.dispose();
}
