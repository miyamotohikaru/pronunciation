/**
 * src/engine/scoring/ipa.ts == content/ipa.py (the curriculum's CMUdict -> IPA) on every CMUdict
 * pronunciation, so a word reads the same in content/*.json and in an item.
 *   node ipa-parity.mts      (exit 1 on any difference)
 * Words whose CMUdict entry has a secondary stress but no primary are skipped: ipa.ts gives those
 * a primary (as a dictionary prints a word that misaki stressed only weakly in its sentence).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ipaSegments } from "../../src/engine/scoring/ipa.ts";
import { ROOT } from "./lib.mts";

const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(ROOT, "content"))})
import ipa
out = []
for w, prons in ipa.cmu().items():
    for p in prons:
        out.append([w, p, ipa.to_ipa(p)])
json.dump(out, sys.stdout, ensure_ascii=False)
`;

export function ipaParity(): { checked: number; skipped: number; diffs: string[] } {
  if (!existsSync(join(ROOT, "content/ipa.py"))) return { checked: 0, skipped: 0, diffs: ["content/ipa.py not found"] };
  const r = spawnSync("python3", ["-c", py], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) return { checked: 0, skipped: 0, diffs: [`python3 failed: ${r.stderr.slice(0, 500)}`] };
  const rows = JSON.parse(r.stdout) as [string, string[], string][];
  const diffs: string[] = [];
  let skipped = 0;
  for (const [w, phones, want] of rows) {
    if (!phones.some((p) => p.endsWith("1")) && phones.some((p) => p.endsWith("2"))) {
      skipped++;
      continue;
    }
    const got = ipaSegments(phones).join("");
    if (got !== want) diffs.push(`${w} ${phones.join(" ")}: ipa.ts ${got} / ipa.py ${want}`);
  }
  return { checked: rows.length - skipped, skipped, diffs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = ipaParity();
  console.log(`${r.checked} CMUdict pronunciations checked (${r.skipped} with no primary stress skipped), ${r.diffs.length} differences`);
  for (const d of r.diffs.slice(0, 20)) console.log("  " + d);
  process.exit(r.diffs.length ? 1 : 0);
}
