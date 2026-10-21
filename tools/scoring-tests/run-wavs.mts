/**
 * Scores every test clip and prints what the engine found.
 *   node run-wavs.mts [filter] [--json out.json]
 */
import { writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { makeScorer, readWav, targetsFor, targetsFromKokoro } from "./lib.mts";
import { cases, kokoroJsons, type Case } from "./cases.mts";
import type { ScoreResult } from "../../src/engine/scoring/types.ts";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const filter = args.find((a) => !a.startsWith("--") && a !== jsonOut) ?? "";
/** --raw: misaki + CMUdict variants only (no variants learned from the references) */
const raw = args.includes("--raw");

export function verdict(c: Case, r: ScoreResult): { ok: boolean; why: string } {
  const e = c.expect;
  const flagged = r.words.flatMap((w) => w.phones.filter((p) => p.issue));
  if (e.kind === "native") {
    const low = r.words.filter((w) => w.score < 90);
    const ok = low.length === 0 && r.sounds >= 90 && flagged.length === 0 && r.insertions.length === 0;
    return { ok, why: ok ? "" : `low words: ${low.map((w) => `${w.text}=${w.score}`).join(",")} flags=${flagged.length} ins=${r.insertions.length}` };
  }
  if (e.kind === "accent") {
    const ok = r.words.some((w) => w.score < 60) || flagged.length + r.insertions.length > 0;
    return { ok, why: ok ? "" : "nothing flagged" };
  }
  const w = r.words[e.word];
  let ok = w.score < 60;
  const why: string[] = [];
  if (!ok) why.push(`word ${w.text}=${w.score} (want < 60)`);
  if (e.phone !== undefined) {
    const p = w.phones[e.phone];
    if (!p?.issue) {
      ok = false;
      why.push(`phone ${p?.phone} not flagged`);
    } else if (e.heardAs && !(p.heardAs && e.heardAs.includes(p.heardAs))) {
      why.push(`heardAs ${p.heardAs ?? "-"} (want ${e.heardAs.join("/")})`);
    }
  }
  if (e.insertion && !r.insertions.some((x) => x.wordIndex === e.word)) {
    ok = false;
    why.push("no insertion found");
  }
  return { ok, why: why.join("; ") };
}

export function describe(r: ScoreResult): string {
  const lines: string[] = [];
  lines.push(
    "  " +
      r.words
        .map((w) => `${w.text}=${w.score}[v${w.variant}] ` + w.phones.map((p) => `${p.phone}:${Math.round(p.score)}${p.issue ? `(${p.issue.slice(0, 3)}${p.heardAs ? ">" + p.heardAs : ""})` : ""}`).join(" "))
        .join(" | "),
  );
  if (r.insertions.length) lines.push("  insertions: " + r.insertions.map((x) => `w${x.wordIndex}+${x.afterPhoneIndex}:${x.vowel}@${x.start.toFixed(2)}`).join(" "));
  lines.push(`  heard: ${r.heard.join(" ")}`);
  return lines.join("\n");
}

async function main() {
  const scorer = await makeScorer();
  const all: Record<string, unknown>[] = [];
  let pass = 0;
  let n = 0;
  for (const c of cases()) {
    if (filter && !c.file.includes(filter)) continue;
    const { audio } = readWav(c.file);
    const words = raw && !c.text ? targetsFromKokoro(kokoroJsons(c.sentence)) : await targetsFor(scorer, c);
    const r = await scorer.score({ audio, words });
    const v = verdict(c, r);
    n++;
    if (v.ok) pass++;
    const name = `${basename(dirname(c.file))}/${basename(c.file)}`;
    console.log(`${v.ok ? "PASS" : "FAIL"} ${name.padEnd(36)} sounds=${r.sounds} ${c.expect.kind}${c.note ? " (" + c.note + ")" : ""} ${v.why}`);
    console.log(describe(r));
    all.push({ file: c.file, sentence: c.sentence, expect: c.expect, ok: v.ok, why: v.why, result: r, words });
  }
  console.log(`\n${pass}/${n} as expected`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(all, null, 1));
  await scorer.dispose();
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
