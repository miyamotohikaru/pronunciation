/**
 * Build-time helper: standard connected-speech variants, added to the target words before
 * the reference-derived ones (reference.ts). Natives reduce function words ("do you" ->
 * D AH Y AH) and leave word-final T/D unreleased or glottal before a consonant; none of
 * this should cost a learner points. Variants are only ever added, never removed.
 */
import type { TargetWord } from "./types.ts";
import { isVowel, parseVariant } from "./phones.ts";

/** Weak forms of common function words (ARPAbet, stress digits as in CMUdict). */
export const WEAK_FORMS: Record<string, string[]> = {
  a: ["AH0", "EY1"],
  an: ["AH0 N", "AE1 N"],
  the: ["DH AH0", "DH IY0", "DH IH0"],
  and: ["AH0 N D?", "AE1 N D", "N"],
  but: ["B AH0 T", "B AH1 T"],
  or: ["ER0", "AO1 R"],
  of: ["AH0 V", "AH0", "AH1 V", "AH0 V?"],
  to: ["T AH0", "T UW1", "T IH0", "T UH0", "DX AH0", "T AH0?"],
  for: ["F ER0", "F AO1 R"],
  from: ["F R AH0 M", "F R AH1 M"],
  at: ["AH0 T", "AE1 T"],
  as: ["AH0 Z", "AE1 Z"],
  can: ["K AH0 N", "K AE1 N"],
  could: ["K UH1 D", "K AH0 D"],
  would: ["W UH1 D", "W AH0 D"],
  should: ["SH UH1 D", "SH AH0 D"],
  do: ["D UW1", "D AH0", "D UH0", "D AH0?"],
  does: ["D AH1 Z", "D AH0 Z"],
  did: ["D IH1 D", "D IH0 D"],
  have: ["HH AE1 V", "HH AH0 V", "AH0 V"],
  has: ["HH AE1 Z", "HH AH0 Z", "AH0 Z"],
  had: ["HH AE1 D", "HH AH0 D", "AH0 D"],
  was: ["W AA1 Z", "W AH0 Z"],
  were: ["W ER1", "W ER0"],
  are: ["AA1 R", "ER0"],
  is: ["IH1 Z", "IH0 Z"],
  am: ["AE1 M", "AH0 M"],
  be: ["B IY1", "B IY0", "B IH0"],
  been: ["B IH1 N", "B IH0 N"],
  you: ["Y UW1", "Y AH0", "Y UH0", "Y AH0?"],
  your: ["Y AO1 R", "Y ER0"],
  he: ["HH IY1", "IY0"],
  him: ["HH IH1 M", "IH0 M"],
  her: ["HH ER1", "ER0"],
  them: ["DH EH1 M", "DH AH0 M", "AH0 M"],
  us: ["AH1 S", "AH0 S"],
  some: ["S AH1 M", "S AH0 M"],
  than: ["DH AE1 N", "DH AH0 N"],
  that: ["DH AE1 T", "DH AH0 T"],
  there: ["DH EH1 R", "DH ER0"],
  will: ["W IH1 L", "AH0 L"],
  just: ["JH AH1 S T", "JH IH0 S T", "JH AH0 S"],
};

const STOPS = new Set(["T", "D"]);

function key(v: string | string[]): string {
  return (typeof v === "string" ? v.trim().split(/\s+/) : v).join(" ");
}

/** Returns new words with weak forms and unreleased final T/D added. */
export function addConnectedSpeech(words: TargetWord[]): TargetWord[] {
  const out = words.map((w) => ({ text: w.text, variants: w.variants.map(key) }));
  const add = (w: number, v: string) => {
    if (!out[w].variants.includes(v)) out[w].variants.push(v);
  };
  out.forEach((w, wi) => {
    const tokens = w.text.toLowerCase().match(/[a-z']+/g) ?? [];
    if (tokens.length === 1 && WEAK_FORMS[tokens[0]]) for (const v of WEAK_FORMS[tokens[0]]) add(wi, v);
    // final T/D before a consonant-initial word: unreleased or glottal (Q = T/D or nothing)
    const next = out[wi + 1];
    if (!next) return;
    const nextStarts = next.variants.map((v) => parseVariant(v)[0]).filter(Boolean);
    if (!nextStarts.length || nextStarts.every((t) => isVowel(t.symbol))) return;
    for (const v of w.variants.slice()) {
      const toks = parseVariant(v);
      const last = toks[toks.length - 1];
      if (toks.length > 1 && STOPS.has(last.base) && !last.optional) add(wi, toks.slice(0, -1).map((t) => t.symbol + (t.optional ? "?" : "")).concat("Q").join(" "));
    }
  });
  return out;
}
