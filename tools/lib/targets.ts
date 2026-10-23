/**
 * Target words for the scorer from Kokoro reference clips (misaki phonemes) and CMUdict.
 * Shared by tools/build-content (the content build) and tools/scoring-tests.
 */
import { misakiToArpabet } from "../../src/engine/scoring/misaki.ts";
import type { TargetWord } from "../../src/engine/scoring/types.ts";

/** The parts of a tools/tts output JSON (.work/tts/<voice>/<id>.json) used here. */
export type KokoroWord = { text: string; phonemes: string; start: number; end: number };
export type KokoroClip = {
  id: string;
  text: string;
  tts_text?: string;
  duration: number;
  phonemes: string;
  words: KokoroWord[];
};

export type Cmudict = Map<string, string[][]>;

/** Words of a text for lookup: lower case, keeps apostrophes. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

/** CMUdict variants of a chunk ("check it out" -> every combination, capped); [] if a word is unknown. */
export function cmuVariants(chunk: string, cmu: Cmudict, cap = 8): string[][] {
  let acc: string[][] = [[]];
  for (const w of tokenize(chunk)) {
    const vs = cmu.get(w);
    if (!vs) return [];
    const next: string[][] = [];
    for (const a of acc) for (const v of vs) if (next.length < cap) next.push(a.concat(v));
    acc = next;
  }
  return acc.filter((v) => v.length);
}

/**
 * One target word per word of the first clip: the misaki variants of every clip (each voice
 * may say it differently) first, then the CMUdict ones; duplicates dropped.
 */
export function targetsFromKokoro(clips: KokoroClip[], cmu: Cmudict): TargetWord[] {
  if (!clips.length) throw new Error("no Kokoro clip");
  return clips[0].words.map((w, i) => {
    const variants: string[] = [];
    const add = (v: string[]) => {
      const k = v.join(" ");
      if (v.length && !variants.includes(k)) variants.push(k);
    };
    for (const c of clips) if (c.words[i]?.text === w.text) add(misakiToArpabet(c.words[i].phonemes));
    for (const v of cmuVariants(w.text, cmu)) add(v);
    if (!variants.length) throw new Error(`no pronunciation for "${w.text}"`);
    return { text: w.text, variants };
  });
}

/** Targets from CMUdict only (sentences without a reference clip). */
export function targetsFromText(text: string, cmu: Cmudict): TargetWord[] {
  return tokenize(text).map((w) => {
    const variants = cmuVariants(w, cmu).map((v) => v.join(" "));
    if (!variants.length) throw new Error(`not in cmudict: ${w}`);
    return { text: w, variants };
  });
}
