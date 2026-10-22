/**
 * How much each wrong word gets in the way of being understood, so the result leads with the one
 * or two that matter and folds the rest (「ほかに3か所」). A sound weighs more when it is far off,
 * when it was heard as another sound (right → light: another word), when it is one of the contrasts
 * English leans on (r/l, th, v/b, the short vowels), and when its word carries the meaning (rice,
 * not the). Marks on the line get darker with the weight.
 */
import type { WordScore } from "../types";
import { mark } from "../score";
import { isWeakWord } from "../ipa";

const CONTRAST = new Set(["R", "L", "TH", "DH", "V", "F", "B", "W", "ER", "AE", "AH", "AA", "IH", "IY", "UH", "UW", "S", "SH", "Z"]);

export function weighWord(w: WordScore): number {
  let sum = 0;
  for (const p of w.phones) {
    if (mark(p) !== "miss") continue;
    let s = Math.max(0.15, (100 - p.score) / 100);
    if (p.heardAs) s *= 1.35;
    else if (p.issue === "deletion") s *= 1.25;
    else if (p.issue === "distortion") s *= 0.85;
    if (CONTRAST.has(p.phone.replace(/[0-2]$/, ""))) s *= 1.3;
    sum += s;
  }
  return sum * (isWeakWord(w.text) ? 0.55 : 1.25);
}

export type Ranked = { index: number; weight: number };

/** the wrong words, heaviest first */
export function rankMistakes(words: WordScore[]): Ranked[] {
  return words
    .map((w, i) => ({ index: i, weight: w.phones.some((p) => mark(p) === "miss") ? weighWord(w) : 0 }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
}

/** the ones the result leads with: the heaviest, and the next if it weighs at least half as much */
export function leadCount(r: Ranked[]): number {
  if (r.length < 2) return r.length;
  return r[1].weight >= r[0].weight * 0.5 ? 2 : 1;
}
