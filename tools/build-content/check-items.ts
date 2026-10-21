/**
 * Does a built item still catch errors? Scores macOS `say` clips (native Samantha, a
 * deliberate error, Kyoko reading katakana) against public/content/items/<id>.json, with
 * the item's calibrated scoring and with the model defaults.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tools/build-content/check-items.ts
 * Clips are generated into .work/audio/items/ on first run (macOS only).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readWav } from "./wav.ts";
import { makeNodeScorer, ROOT } from "../lib/scorer-node.ts";
import type { ItemData, ItemWord } from "../../src/data/schema.ts";
import type { ScoreOptions, ScoreResult } from "../../src/engine/scoring/types.ts";

type Case = { item: string; target?: "pair"; voice: "Samantha" | "Kyoko"; say: string; kind: "native" | "error" | "accent"; note: string };

const CASES: Case[] = [
  { item: "u03-l1-07", voice: "Samantha", say: "rice", kind: "native", note: "rice" },
  { item: "u03-l1-07", voice: "Samantha", say: "lice", kind: "error", note: "rice -> lice" },
  { item: "u03-l1-07", voice: "Kyoko", say: "ライス", kind: "accent", note: "raisu" },
  { item: "u03-l2-01", voice: "Samantha", say: "light", kind: "native", note: "light" },
  { item: "u03-l2-01", voice: "Samantha", say: "right", kind: "error", note: "light -> right" },
  { item: "u03-l2-01", voice: "Kyoko", say: "ライト", kind: "accent", note: "raito" },
  { item: "u03-l3-02", voice: "Samantha", say: "lice", kind: "error", note: "pair: rice said as lice" },
  { item: "u03-l3-02", target: "pair", voice: "Samantha", say: "rice", kind: "error", note: "pair: lice said as rice" },
  { item: "u07-l1-02", voice: "Samantha", say: "think", kind: "native", note: "think" },
  { item: "u07-l1-02", voice: "Samantha", say: "sink", kind: "error", note: "think -> sink" },
  { item: "u07-l1-02", voice: "Kyoko", say: "シンク", kind: "accent", note: "shinku" },
  { item: "u07-l3-01", target: "pair", voice: "Samantha", say: "think", kind: "error", note: "pair: sink said as think" },
  { item: "u07-l1-01", voice: "Samantha", say: "sank", kind: "error", note: "thank -> sank" },
  { item: "u07-l2-01", voice: "Samantha", say: "this", kind: "native", note: "this" },
  { item: "u07-l2-01", voice: "Samantha", say: "zis", kind: "error", note: "this -> zis" },
  { item: "u07-l2-01", voice: "Kyoko", say: "ディス", kind: "accent", note: "disu" },
  { item: "u08-l1-01", voice: "Samantha", say: "very", kind: "native", note: "very" },
  { item: "u08-l1-01", voice: "Samantha", say: "berry", kind: "error", note: "very -> berry" },
  { item: "u08-l1-01", voice: "Kyoko", say: "ベリー", kind: "accent", note: "berii" },
  { item: "u08-l1-02", voice: "Samantha", say: "boice", kind: "error", note: "voice -> boice" },
  { item: "u02-l2-07", voice: "Samantha", say: "street", kind: "native", note: "street" },
  { item: "u02-l2-07", voice: "Samantha", say: "sue toe ree toe", kind: "error", note: "street -> sutoreeto" },
  { item: "u02-l2-07", voice: "Kyoko", say: "ストリート", kind: "accent", note: "sutoriito" },
  { item: "u02-l1-06", voice: "Samantha", say: "bed", kind: "native", note: "bed" },
  { item: "u02-l1-06", voice: "Samantha", say: "beddo", kind: "error", note: "bed -> beddo" },
  { item: "u02-l1-06", voice: "Kyoko", say: "ベッド", kind: "accent", note: "beddo" },
  { item: "u02-l1-07", voice: "Samantha", say: "milk", kind: "native", note: "milk" },
  { item: "u02-l1-07", voice: "Samantha", say: "mee roo koo", kind: "error", note: "milk -> miruku" },
  { item: "u02-l1-07", voice: "Kyoko", say: "ミルク", kind: "accent", note: "miruku" },
  { item: "u04-l1-01", voice: "Samantha", say: "cat", kind: "native", note: "cat" },
  { item: "u04-l1-01", voice: "Samantha", say: "cut", kind: "error", note: "cat -> cut" },
  { item: "u04-l1-01", voice: "Kyoko", say: "キャット", kind: "accent", note: "kyatto" },
  { item: "u09-l1-03", voice: "Samantha", say: "sheep", kind: "error", note: "pair: ship said as sheep" },
  { item: "u09-l1-03", target: "pair", voice: "Samantha", say: "ship", kind: "error", note: "pair: sheep said as ship" },
  { item: "p1", voice: "Samantha", say: "Turn right at the light.", kind: "native", note: "placement 1" },
  { item: "p1", voice: "Samantha", say: "Turn light at the right.", kind: "error", note: "R/L swapped" },
  { item: "p1", voice: "Kyoko", say: "ターン ライト アット ザ ライト", kind: "accent", note: "katakana" },
  { item: "p2", voice: "Samantha", say: "I think this is very good.", kind: "native", note: "placement 2" },
  { item: "p2", voice: "Kyoko", say: "アイ シンク ディス イズ ベリー グッド", kind: "accent", note: "katakana" },
];

const DIR = join(ROOT, ".work/audio/items");
mkdirSync(DIR, { recursive: true });
const fileOf = (c: Case) => join(DIR, `${c.voice}_${c.say.replace(/[^\p{L}\p{N}]+/gu, "_")}.wav`);

function ensureClip(c: Case): string {
  const f = fileOf(c);
  if (!existsSync(f)) execFileSync("say", ["-v", c.voice, "--file-format=WAVE", "--data-format=LEI16@16000", "-o", f, c.say]);
  return f;
}

const { scorer } = await makeNodeScorer();
const summary = { native: [0, 0], error: [0, 0], accent: [0, 0], errorDefault: [0, 0] };
const flagged = (r: ScoreResult) =>
  r.words.some((w) => w.score < 60) || r.words.some((w) => w.phones.some((p) => p.issue === "substitution" || p.issue === "deletion")) || r.insertions.length > 0;
const describe = (r: ScoreResult) =>
  r.words.map((w) => `${w.text}=${w.score}` + w.phones.filter((p) => p.issue).map((p) => ` ${p.phone}:${p.issue!.slice(0, 3)}${p.heardAs ? ">" + p.heardAs : ""}`).join("")).join(" | ") +
  r.insertions.map((x) => ` +${x.vowel}`).join("");

for (const c of CASES) {
  const item = JSON.parse(readFileSync(join(ROOT, "public/content/items", `${c.item}.json`), "utf8")) as ItemData;
  const src: { words: ItemWord[]; scoring?: ItemData["scoring"] } = c.target === "pair" && item.pairItem ? item.pairItem : item;
  const audio = readWav(ensureClip(c)).samples;
  const words = src.words.map((w) => ({ text: w.text, variants: w.variants }));
  const withItem = await scorer.score({ audio, words }, (src.scoring ?? {}) as ScoreOptions);
  const plain = await scorer.score({ audio, words });
  const f = flagged(withItem);
  const ok = c.kind === "native" ? !f && withItem.words.every((w) => w.score >= 90) : f;
  summary[c.kind][0] += ok ? 1 : 0;
  summary[c.kind][1]++;
  if (c.kind === "error") {
    summary.errorDefault[0] += flagged(plain) ? 1 : 0;
    summary.errorDefault[1]++;
  }
  console.log(`${ok ? "OK" : "NG"} ${c.item}${c.target ? "/pair" : ""} ${c.voice.padEnd(8)} ${c.kind.padEnd(6)} ${c.note.padEnd(28)} item: ${describe(withItem)}   || default: ${describe(plain)}`);
}
console.log(`\nnative ok ${summary.native[0]}/${summary.native[1]}, errors caught ${summary.error[0]}/${summary.error[1]} (model defaults ${summary.errorDefault[0]}/${summary.errorDefault[1]}), Kyoko flagged ${summary.accent[0]}/${summary.accent[1]}`);
await scorer.dispose();
