/**
 * A line split into syllables for the home card: which letters make each syllable, which ones are
 * strong (ho·TEL), and when the model says each one (for the karaoke wipe).
 * Syllables from the engine's syllabify (maximum onset), letters from the spelling aligner,
 * timing from the reference voice's own syllables (evenly over the word if the counts differ).
 */
import type { ItemData } from "@/data/schema";
import { syllabify } from "@/engine/prosody/syllables.ts";
import { alignLetters } from "../practice/letters";
import { refFor, type VoiceId } from "../practice/content";

export type Piece = {
  /** letters as shown (the spelling as it is: the strong syllable is shown by size, not by capitals) */
  text: string;
  strong: boolean;
  /** a "·" follows (another syllable of the same word comes next) */
  dot: boolean;
  start: number;
  end: number;
};

export function piecesFor(item: Pick<ItemData, "text" | "words" | "refs">, voice: VoiceId): Piece[][] {
  const ref = refFor(item, voice);
  const spans = item.words.flatMap((w, wi) => w.phones.map((phone) => ({ phone, word: wi, start: 0, end: 0 })));
  const syl = syllabify(spans, item.words.map((w) => w.text));
  const tokens = item.text.split(/\s+/).filter(Boolean);
  let offset = 0;
  return item.words.map((w, wi) => {
    const base = offset;
    offset += w.phones.length;
    const tok = tokens[wi] ?? w.text;
    const mine = syl.filter((s) => s.word === wi);
    const letters = alignLetters(w.text, w.phones);
    const ws = ref.words[wi] ?? { start: 0, end: 0.4 };
    const refSyl = ref.syllables.filter((s) => s.word === wi);
    const n = Math.max(1, mine.length);
    const cuts = mine.map((s, k) => (k === 0 ? 0 : (letters[s.phones[0] - base]?.[0] ?? 0)));
    for (let k = 1; k < cuts.length; k++) cuts[k] = Math.min(tok.length, Math.max(cuts[k], cuts[k - 1] + 1));
    if (!mine.length) return [{ text: tok, strong: true, dot: false, start: ws.start, end: ws.end }];
    return mine.map((s, k) => {
      const a = cuts[k];
      const b = k + 1 < cuts.length ? cuts[k + 1] : tok.length;
      const strong = s.sentenceStress === 1;
      const t = refSyl.length === mine.length ? refSyl[k] : { start: ws.start + ((ws.end - ws.start) * k) / n, end: ws.start + ((ws.end - ws.start) * (k + 1)) / n };
      const text = tok.slice(a, b);
      return { text, strong, dot: k + 1 < mine.length, start: t.start, end: t.end };
    });
  });
}
