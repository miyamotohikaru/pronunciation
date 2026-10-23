/**
 * forcedAlign / mergeTokens vs torchaudio on random cases (ties, repeats, tight T).
 *   node align-fuzz.mts      (runs tools/model/export/align_cases.py first)
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readJson, ROOT, WORK } from "./lib.mts";
import { forcedAlign, mergeTokens } from "../../src/engine/scoring/ctc.ts";

const file = join(WORK, "eval", "align_cases.json");
const py = spawnSync(join(ROOT, ".venv/bin/python"), ["-I", join(ROOT, "tools/model/export/align_cases.py"), file, "600"], { encoding: "utf8" });
if (py.status !== 0) throw new Error(py.stderr);
const cases = readJson<{ T: number; C: number; targets: number[]; em: number[]; path: number[]; spans: number[][] }[]>(file);
let bad = 0;
for (const c of cases) {
  const path = forcedAlign(Float32Array.from(c.em), c.T, c.C, c.targets, 0);
  const spans = mergeTokens(path, 0).map((s) => [s.token, s.start, s.end]);
  if (JSON.stringify(Array.from(path)) !== JSON.stringify(c.path) || JSON.stringify(spans) !== JSON.stringify(c.spans)) bad++;
}
console.log(`forcedAlign vs torchaudio: ${cases.length - bad}/${cases.length} identical paths and spans`);
if (bad) process.exit(1);
