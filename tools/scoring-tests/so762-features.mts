/**
 * GOP features of speechocean762 through the TS engine itself (regressor training / PCC).
 *   node so762-features.mts --model-dir <dir> --split train|test --out <file.json>
 * Needs .work/datasets/speechocean762/wav/<split>/*.wav + <split>.json
 * (tools/model/export/dump_speechocean.py). Each utterance is scored against exactly its
 * labelled phones (one variant, nothing optional), so every phone gets its features.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeScorer, readWav, WORK } from "./lib.mts";

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const dir = arg("--model-dir");
const split = arg("--split", "test")!;
const out = arg("--out")!;
const limit = Number(arg("--limit", "0"));

type Utt = { i: number; text: string; words: { text: string; phones: string[]; scores: number[] }[] };
const base = join(WORK, "datasets/speechocean762/wav");
const utts = JSON.parse(readFileSync(join(base, `${split}.json`), "utf8")) as Utt[];
const scorer = await makeScorer({ dir });
const res = { phones: [] as string[], features: [] as number[][], human: [] as number[], raw: [] as number[], utt: [] as number[] };
let skipped = 0;
const t0 = Date.now();
for (const u of limit ? utts.slice(0, limit) : utts) {
  const words = u.words.filter((w) => w.phones.length).map((w) => ({ text: w.text, variants: [w.phones.join(" ")] }));
  const human = u.words.flatMap((w) => w.scores);
  if (!words.length) continue;
  const { audio } = readWav(join(base, split, `${String(u.i).padStart(4, "0")}.wav`));
  try {
    const r = await scorer.score({ audio, words }, { features: true, variantChoice: "likelihood" });
    const ph = r.words.flatMap((w) => w.phones);
    if (ph.length !== human.length) throw new Error("phone count");
    ph.forEach((p, k) => {
      res.phones.push(p.phone);
      res.features.push(p.features!);
      res.human.push(human[k]);
      res.raw.push(p.raw);
      res.utt.push(u.i);
    });
  } catch {
    skipped++;
  }
  if (u.i % 500 === 499) console.log(`${u.i + 1} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
writeFileSync(out, JSON.stringify(res));
console.log(`${split}: ${res.human.length} phones, ${skipped} skipped, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await scorer.dispose();
