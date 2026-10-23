/**
 * The UI side of the one sound notation. The transcription itself lives in the engine
 * (src/engine/scoring/ipa.ts, dictionary style: /ráɪs/) and in the data (item.ipa, words[].ipa);
 * this file only picks the data first and adds the short Japanese name shown under a chip.
 */
import { lineMarks } from "./marks/lineMarks";
import { ipaChip, ipaLine, ipaSegments } from "@/engine/scoring/ipa.ts";
import { HEARD_LABELS } from "@/engine/scoring/heard-labels.ts";
import { isFunctionWord } from "@/engine/prosody/syllables.ts";

/** a chip: /ð/ */
export const chipIpa = ipaChip;

/** a word without slashes: ráɪs (the data's words[].ipa first) */
export function wordIpa(phones: readonly string[], data?: string): string {
  return data ? data.replace(/^\/|\/$/g, "") : ipaSegments(phones).join("");
}

const unmark = (s: string) => s.replace(/[\u0301\u0300]/g, "");
/**
 * a weak function word (the, is, a, …): no ● over it, no stress mark in a line (a dictionary marks each
 * word, a sentence does not), little weight in the result. The engine's list, so ● and the marks agree.
 */
export const isWeakWord = isFunctionWord;

/**
 * the whole line: /aɪ hæv‿ən‿aɪdíːə/ — the words' own ipa first; weak function words without marks;
 * where two words run on (src/ui/marks, the engine's findLinks) a ‿ instead of the space
 */
export function lineIpa(item: { text?: string; words: { text?: string; phones: string[]; ipa?: string }[]; ipa?: string }): string {
  if (item.words.every((w) => w.ipa && w.text !== undefined)) {
    const parts = item.words.map((w) => {
      const body = (w.ipa ?? "").replace(/^\/|\/$/g, "");
      return isFunctionWord(w.text ?? "") ? unmark(body) : body;
    });
    const link = item.text ? lineMarks(item.text, item.words as { text: string; phones: string[] }[]).link : [];
    return `/${parts.map((p, i) => (i ? (link[i - 1] ? "‿" : " ") : "") + p).join("")}/`;
  }
  if (item.ipa) return item.ipa.startsWith("/") ? item.ipa : `/${item.ipa}/`;
  return ipaLine(item.words.map((w) => w.phones));
}

/** the word as it was heard: one phone swapped, stress kept (rice, R → L: láɪs) */
export function heardWordIpa(phones: readonly string[], index: number, heard: string): string {
  const d = phones[index]?.match(/([0-2])$/)?.[1] ?? "";
  const swapped = phones.map((p, i) => (i !== index ? p : /^[A-Z]{1,2}$/.test(heard) && d ? heard + d : heard));
  return ipaSegments(swapped).join("");
}

/** the short Japanese name under a chip (English sounds; the scorer's Japanese-like sounds by their label) */
const NAME: Record<string, string> = {
  R: "舌を引く r", L: "舌を付ける l", DH: "濁る th", TH: "息の th", Z: "ズ", S: "ス", SH: "シュ", ZH: "ジュ",
  D: "ド", T: "ト", V: "唇をかむヴ", F: "唇をかむフ", B: "ブ", P: "プ", HH: "ハ行", W: "ウ", Y: "ユ",
  N: "ン", M: "ム", NG: "鼻のン", K: "ク", G: "グ", CH: "チ", JH: "ジ",
  AE: "エに近いア", AH: "あいまいなア", AA: "大きく開くア", AO: "オー", AW: "アウ", AY: "アイ", EH: "エ",
  ER: "舌を丸めたアー", EY: "エイ", IH: "短いイ", IY: "長いイー", OW: "オウ", OY: "オイ", UH: "短いウ", UW: "長いウー",
};
export function soundNameJa(phone: string): string {
  const base = /^[A-Z]{1,2}[0-2]?$/.test(phone) ? phone.replace(/[0-2]$/, "") : phone;
  return NAME[base] ?? HEARD_LABELS[base] ?? base;
}
