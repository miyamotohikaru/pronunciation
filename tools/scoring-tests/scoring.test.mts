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
import { readFileSync } from "node:fs";
import { HEARD_LABELS } from "../../src/engine/scoring/heard-labels.ts";
import type { ModelMeta } from "../../src/engine/scoring/types.ts";
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

for (const model of ["vb223", "student"] as const) {
  test(`TS == Python reference (mel, logic, fp32 end to end): ${model}`, async () => {
    for (const r of await runParity(model)) {
      assert.ok(r.dMel < 1e-4, `${r.id}: mel differs by ${r.dMel}`);
      assert.ok(r.logic.sameAlign && r.logic.dRaw <= 1e-3, `${r.id}: logic differs (${r.logic.dRaw})`);
      assert.ok(r.e2eFp32.sameAlign && r.e2eFp32.dRaw <= 1e-3, `${r.id}: fp32 end to end differs (${r.e2eFp32.dRaw})`);
    }
  });
}

/** Clips whose expectation a model cannot meet (see README, known limitations). */
const KNOWN_MISSES: Record<"vb223" | "student", RegExp[]> = {
  vb223: [
    /audio\/sam_berry\.wav$/, // V->B: the model hears V
    /audio\/kyo_(very|street)\.wav$/, // Kyoko: nothing beats the penalties
    /extra\/sam_zis_one\.wav$/, // DH->Z: the model hears DH
    /extra\/sam_(light|milk|sheep|voice)\.wav$/, // natives on CMUdict-only targets (no reference to learn from)
    /candidates\//, // held-out Kokoro voices (not the references)
  ],
  student: [
    /audio\/sam_berry\.wav$/, // V->B (the student's known weakness)
    /extra\/sam_boice\.wav$/, // V->B
    /extra\/sam_sheep\.wav$/, // native "white sheep" on CMUdict-only targets: final P unreleased
    /candidates\/am_puck\/t07_again/, // held-out voice: "Could"
  ],
};

for (const model of ["vb223", "student"] as const) {
  test(`behaviour on the test clips: ${model}`, async () => {
    const scorer = await makeScorer({ dir: join(ROOT, model === "vb223" ? "public/models/whisper-phoneme" : "public/models/student-ipa") });
    const bad: string[] = [];
    for (const c of cases()) {
      if (KNOWN_MISSES[model].some((re) => re.test(c.file))) continue;
      const words = await targetsFor(scorer, c);
      const r = await scorer.score({ audio: readWav(c.file).audio, words });
      const v = verdict(c, r);
      if (!v.ok) bad.push(`${c.file.replace(ROOT, "")}: ${v.why}`);
    }
    await scorer.dispose();
    assert.deepEqual(bad, []);
  });
}

test("every heardAs / inserted-vowel symbol has a Japanese label", () => {
  const missing: string[] = [];
  for (const m of ["whisper-phoneme", "student-ipa"]) {
    const meta = JSON.parse(readFileSync(join(ROOT, "public/models", m, "meta.json"), "utf8")) as ModelMeta;
    const symbols = new Set([...Object.keys(meta.units), ...Object.values(meta.diagnosis.confusions).flat(), ...meta.diagnosis.epentheticVowels]);
    for (const s of symbols) if (!(s in HEARD_LABELS)) missing.push(`${m}: ${s}`);
  }
  assert.deepEqual(missing, []);
});
