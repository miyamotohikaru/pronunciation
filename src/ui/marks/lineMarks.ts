/**
 * The marks of an English line, without the voice's timing (the same reading as the home card's
 * piecesFor): for each word the letters of its strong syllable — a content word's primary stress,
 * a one-syllable content word whole, a function word nothing — and whether it runs on into the next
 * word (the engine's findLinks: an‿idea, go‿out, bus‿stop, did‿you).
 * Computed once per line (memoised on the words array, then the text).
 */
import { syllabify } from "@/engine/prosody/syllables.ts";
import { findLinks, type LinkKind } from "@/engine/prosody/linking.ts";
import { alignLetters } from "../practice/letters";

export type LineMarks = {
  /** per word (the line's whitespace tokens): the strong syllable's letters in its token, [from, to) */
  strong: ([number, number] | null)[];
  /** per word: it runs on into the next word (‿ after it) */
  link: (LinkKind | null)[];
};

type Word = { text: string; phones: readonly string[] };

const memo = new WeakMap<object, Map<string, LineMarks>>();

export function lineMarks(text: string, words: readonly Word[]): LineMarks {
  let byText = memo.get(words);
  const hit = byText?.get(text);
  if (hit) return hit;
  const out = compute(text, words);
  if (!byText) memo.set(words, (byText = new Map()));
  byText.set(text, out);
  return out;
}

function compute(text: string, words: readonly Word[]): LineMarks {
  const tokens = text.split(/\s+/).filter(Boolean);
  const spans = words.flatMap((w, wi) => w.phones.map((phone) => ({ phone, word: wi, start: 0, end: 0 })));
  const syl = syllabify(spans, words.map((w) => w.text));
  let offset = 0;
  const strong = words.map((w, wi): [number, number] | null => {
    const base = offset;
    offset += w.phones.length;
    const mine = syl.filter((s) => s.word === wi);
    const k = mine.findIndex((s) => s.sentenceStress === 1);
    if (k < 0) return null;
    const tok = tokens[wi] ?? w.text;
    // where the word's letters sit in its token (punctuation around it: “Hi, ready, eat.)
    const at = tok.toLowerCase().indexOf(w.text.toLowerCase());
    const off = at >= 0 ? at : 0;
    const len = at >= 0 ? w.text.length : tok.replace(/[^A-Za-z']+$/, "").length;
    if (mine.length === 1) return [off, off + len];
    const letters = alignLetters(w.text, [...w.phones]);
    const cut = (s: (typeof mine)[number]) => letters[s.phones[0] - base]?.[0] ?? 0;
    const a = k === 0 ? 0 : cut(mine[k]);
    const b = k + 1 < mine.length ? cut(mine[k + 1]) : len;
    if (!(b > a)) return [off, off + len];
    return [off + a, off + Math.min(len, b)];
  });
  const link: (LinkKind | null)[] = words.map(() => null);
  for (const l of findLinks(text, words)) link[l.after] = l.kind;
  return { strong, link };
}
