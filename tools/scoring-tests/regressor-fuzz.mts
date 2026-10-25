/**
 * hgbr.ts vs sklearn on random inputs: predictions must be bit-identical.
 *   node regressor-fuzz.mts
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadAssetsFs, readJson, ROOT, WORK } from "./lib.mts";
import { loadRegressor } from "../../src/engine/scoring/hgbr.ts";

const file = join(WORK, "eval", "regressor_cases.json");
const py = spawnSync(join(ROOT, ".venv/bin/python"), ["-I", join(ROOT, "tools/model/export/regressor_cases.py"), file], { encoding: "utf8" });
if (py.status !== 0) throw new Error(py.stderr);
const { X, y } = readJson<{ X: number[][]; y: number[] }>(file);
const reg = loadRegressor(loadAssetsFs().regressor);
let same = 0;
let maxDiff = 0;
X.forEach((x, i) => {
  const p = reg.predict(x);
  if (p === y[i]) same++;
  maxDiff = Math.max(maxDiff, Math.abs(p - y[i]));
});
console.log(`regressor vs sklearn: ${same}/${X.length} bit-identical, max |diff| ${maxDiff}`);
if (same !== X.length) process.exit(1);
