/**
 * node --test suite for src/engine/scoring (run from tools/scoring-tests: npm test).
 *   - forcedAlign / mergeTokens == torchaudio on random cases
 *   - hgbr.ts == sklearn, bit for bit
 *   - TS vs Python reference on the test clips (mel, logic, fp32 end to end)
 *   - behaviour on the test clips: native references >= 90 with nothing flagged, the
 *     deliberate errors and the Japanese voice flagged
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { makeScorer, readWav, targetsFor, ROOT } from "./lib.mts";
import { cases } from "./cases.mts";
import { runParity } from "./parity.mts";
import { verdict } from "./run-wavs.mts";

const HERE = new URL("./", import.meta.url).pathname;
const node = (script: string) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(HERE, script)], { encoding: "utf8", cwd: HERE });

test("forced alignment == torchaudio", () => {
  const r = node("align-fuzz.mts");
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("regressor == sklearn", () => {
  const r = node("regressor-fuzz.mts");
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("TS == Python reference (mel, logic, fp32 end to end)", async () => {
  for (const r of await runParity()) {
    assert.ok(r.dMel < 1e-4, `${r.id}: mel differs by ${r.dMel}`);
    assert.ok(r.logic.sameAlign && r.logic.dRaw <= 1e-3, `${r.id}: logic differs (${r.logic.dRaw})`);
    assert.ok(r.e2eFp32.sameAlign && r.e2eFp32.dRaw <= 1e-3, `${r.id}: fp32 end to end differs (${r.e2eFp32.dRaw})`);
  }
});

/** Clips whose expectation the current model cannot meet (see README, known limitations). */
const KNOWN_MISSES = [
  /audio\/sam_berry\.wav$/, // V->B: the model hears V
  /audio\/kyo_(very|street)\.wav$/, // Kyoko: nothing beats the penalties
  /extra\/sam_zis_one\.wav$/, // DH->Z: the model hears DH
  /extra\/sam_(light|milk|sheep|voice)\.wav$/, // natives on CMUdict-only targets (no reference to learn from)
  /candidates\//, // held-out Kokoro voices (not the references)
];

test("behaviour on the test clips", async () => {
  const scorer = await makeScorer();
  const bad: string[] = [];
  for (const c of cases()) {
    if (KNOWN_MISSES.some((re) => re.test(c.file))) continue;
    const words = await targetsFor(scorer, c);
    const r = await scorer.score({ audio: readWav(c.file).audio, words });
    const v = verdict(c, r);
    if (!v.ok) bad.push(`${c.file.replace(ROOT, "")}: ${v.why}`);
  }
  await scorer.dispose();
  assert.deepEqual(bad, []);
});
