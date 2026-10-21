/**
 * Speech Accent Archive (eval only): Japanese vs native English speakers reading the same
 * paragraph, scored by each model with CMUdict targets (no reference audio, no item
 * calibration). Chunks from tools/model/export/saa_prepare.py.
 *   node saa-eval.mts [--model-dir <dir>] ...
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeScorer, readWav, targetsFromText, WORK } from "./lib.mts";
import { addConnectedSpeech } from "../../src/engine/scoring/connected.ts";

type Spk = { id: string; l1: string; a: string[]; b: string[] };
const dirs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const models = dirs.length ? dirs : [""];
const spks = JSON.parse(readFileSync(join(WORK, "eval/saa/saa.json"), "utf8")) as Spk[];

for (const dir of models) {
  const scorer = await makeScorer(dir ? { dir } : {});
  const rows: { id: string; l1: string; sounds: number; low: number; words: number; subs: number; ins: number }[] = [];
  for (const s of spks) {
    let num = 0;
    let den = 0;
    let low = 0;
    let words = 0;
    let subs = 0;
    let ins = 0;
    for (const part of ["a", "b"] as const) {
      const { audio } = readWav(join(WORK, "eval/saa", `${s.id}_${part}.wav`));
      const r = await scorer.score({ audio, words: addConnectedSpeech(targetsFromText(s[part].join(" "))) });
      for (const w of r.words) {
        num += w.score * w.phones.length;
        den += w.phones.length;
        words++;
        if (w.score < 60) low++;
        subs += w.phones.filter((p) => p.issue === "substitution").length;
      }
      ins += r.insertions.length;
    }
    rows.push({ id: s.id, l1: s.l1, sounds: num / den, low, words, subs, ins });
  }
  const ja = rows.filter((r) => r.l1 === "japanese");
  const en = rows.filter((r) => r.l1 === "english");
  let auc = 0;
  for (const e of en) for (const j of ja) auc += e.sounds > j.sounds ? 1 : e.sounds === j.sounds ? 0.5 : 0;
  auc /= en.length * ja.length;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const pct = (rs: typeof rows) => (100 * rs.reduce((a, r) => a + r.low, 0)) / rs.reduce((a, r) => a + r.words, 0);
  console.log(
    `${scorer.meta.id}: sounds JA ${avg(ja.map((r) => r.sounds)).toFixed(1)} vs EN ${avg(en.map((r) => r.sounds)).toFixed(1)}, AUC(EN>JA) ${auc.toFixed(3)}; ` +
      `words < 60: JA ${pct(ja).toFixed(1)} %, EN ${pct(en).toFixed(1)} %; substitutions/speaker JA ${avg(ja.map((r) => r.subs)).toFixed(1)} EN ${avg(en.map((r) => r.subs)).toFixed(1)}; ` +
      `inserted vowels/speaker JA ${avg(ja.map((r) => r.ins)).toFixed(1)} EN ${avg(en.map((r) => r.ins)).toFixed(1)}`,
  );
  await scorer.dispose();
}
