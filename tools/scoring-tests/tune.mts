/**
 * Evidence margins for the diagnosis network, per clip: how much better the best path
 * gets (log-prob) if one phone may become a confusable phone, be skipped, or be followed
 * by an inserted vowel. A finding is reported when its margin beats the penalty, so the
 * penalties must sit above the native margins and below the error margins.
 *   node tune.mts [filter]
 */
import { makeScorer, readWav, targetsFor } from "./lib.mts";
import { cases } from "./cases.mts";
import { buildEmissions, columnFor, isVowel, makeUnitSpace, baseOf, parseVariant } from "../../src/engine/scoring/phones.ts";
import { slotGraph, viterbiGraph, type Slot } from "../../src/engine/scoring/graph.ts";
import { basename, dirname } from "node:path";

const argv = process.argv.slice(2);
const dirArg = argv.includes("--model-dir") ? argv[argv.indexOf("--model-dir") + 1] : undefined;
const filter = argv.find((a) => !a.startsWith("--") && a !== dirArg) ?? "";
const scorer = await makeScorer({ dir: dirArg });
const meta = scorer.meta;
const cfg = meta.diagnosis;

type Margin = { kind: "sub" | "del" | "ins"; word: number; phone: string; idx: number; alt: string; gain: number };

for (const c of cases()) {
  if (filter && !c.file.includes(filter)) continue;
  const { audio } = readWav(c.file);
  const words = await targetsFor(scorer, c);
  const r = await scorer.score({ audio, words });
  // same insertion rule as the engine: no slot where an optional vowel of the variant was skipped
  const realized = r.words.flatMap((w, wi) => {
    const variant = parseVariant(words[wi].variants[w.variant]);
    return w.phones.map((p, k) => {
      const stop = k + 1 < w.phones.length ? w.phones[k + 1].index : variant.length;
      let skippedVowel = false;
      for (let j = p.index + 1; j < stop; j++) if (isVowel(variant[j].symbol)) skippedVowel = true;
      return { word: wi, idx: k, symbol: p.phone, final: k === w.phones.length - 1, skippedVowel };
    });
  });
  const nPh = realized.length;
  const { lp, samples } = await scorer.logProbs(audio, nPh);
  const space = makeUnitSpace(meta);
  const cols = realized.map((p) => columnFor(space, p.symbol));
  const vcols = cfg.epentheticVowels.map((v) => columnFor(space, v));
  const T = Math.min(Math.max(Math.floor(samples / 320), nPh + 5), lp.frames);
  const C = space.tokens.length;
  const em = buildEmissions(lp, T, space);
  const base: Slot[] = cols.map((col) => ({ alts: [{ column: col, cost: 0 }], optional: false, skipCost: 0 }));
  const run = (slots: Slot[]) => viterbiGraph(em, T, C, 0, slotGraph(slots).graph).score;
  const s0 = run(base);
  const margins: Margin[] = [];
  realized.forEach((p, i) => {
    for (const q of cfg.confusions[baseOf(p.symbol)] ?? []) {
      const sl = base.slice();
      sl[i] = { alts: [{ column: cols[i], cost: 0 }, { column: space.baseColumn.get(q)!, cost: 0 }], optional: false, skipCost: 0 };
      margins.push({ kind: "sub", word: p.word, phone: p.symbol, idx: p.idx, alt: q, gain: run(sl) - s0 });
    }
    const sd = base.slice();
    sd[i] = { ...sd[i], optional: true, skipCost: 0 };
    margins.push({ kind: "del", word: p.word, phone: p.symbol, idx: p.idx, alt: "-", gain: run(sd) - s0 });
    const next = realized[i + 1];
    if (!isVowel(p.symbol) && !p.skippedVowel && (p.final || (next && next.word === p.word && !isVowel(next.symbol)))) {
      const si = base.slice();
      si.splice(i + 1, 0, { alts: vcols.map((col) => ({ column: col, cost: 0 })), optional: true, skipCost: 0 });
      margins.push({ kind: "ins", word: p.word, phone: p.symbol, idx: p.idx, alt: "V", gain: run(si) - s0 });
    }
  });
  const name = `${basename(dirname(c.file))}/${basename(c.file)}`;
  const top = (k: string) =>
    margins
      .filter((m) => m.kind === k && m.gain > 0.05)
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 4)
      .map((m) => `${r.words[m.word].text}.${m.phone}${m.kind === "sub" ? ">" + m.alt : ""}=${m.gain.toFixed(2)}`)
      .join(" ");
  console.log(`${c.expect.kind.padEnd(6)} ${name.padEnd(36)} sub[${top("sub")}] del[${top("del")}] ins[${top("ins")}]`);
}
await scorer.dispose();
