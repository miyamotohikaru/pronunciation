/**
 * Frame-level view of a clip: the top units of every non-blank frame.
 *   node debug.mts <wav> [sentence-id]
 */
import { makeScorer, readWav, targetsFromKokoro } from "./lib.mts";
import { kokoroJsons } from "./cases.mts";
import { buildEmissions, makeUnitSpace } from "../../src/engine/scoring/phones.ts";

const [wav, sentence] = process.argv.slice(2);
const scorer = await makeScorer();
const { audio } = readWav(wav);
const words = sentence ? targetsFromKokoro(kokoroJsons(sentence)) : [];
const { lp, samples } = await scorer.logProbs(audio, 20);
const space = makeUnitSpace(scorer.meta);
const T = Math.min(lp.frames, Math.floor(samples / 320) + 2);
const em = buildEmissions(lp, T, space);
const C = space.tokens.length;
for (let t = 0; t < T; t++) {
  const row = Array.from({ length: C }, (_, c) => [c, em[t * C + c]] as [number, number]).sort((a, b) => b[1] - a[1]);
  const pBlank = Math.exp(em[t * C]);
  if (pBlank > 0.9) continue;
  console.log(
    `${String(t).padStart(3)} ${(t / 50).toFixed(2)}s blank=${pBlank.toFixed(2)}  ` +
      row
        .filter(([c]) => c !== 0)
        .slice(0, 4)
        .map(([c, v]) => `${space.names[c]}:${v.toFixed(1)}`)
        .join(" "),
  );
}
if (words.length) {
  const r = await scorer.score({ audio, words });
  console.log(JSON.stringify(r.words.map((w) => ({ t: w.text, s: w.score, v: w.variant, p: w.phones.map((p) => `${p.phone}:${p.score}:${p.raw}@${p.start.toFixed(2)}-${p.end.toFixed(2)}${p.issue ? ":" + p.issue + ">" + (p.heardAs ?? "") : ""}`) }))));
  console.log("variants:", JSON.stringify(words.map((w) => w.variants)));
}
await scorer.dispose();
