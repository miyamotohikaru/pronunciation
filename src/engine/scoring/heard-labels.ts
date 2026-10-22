/**
 * What the result card says about a sound, in the app's one notation (ipa.ts): English sounds as
 * dictionary IPA in slashes; the student model's Japanese-like sounds (ɾ ɯ ɕ …), which no
 * dictionary has a symbol for, by a Japanese name.
 *
 *   heardAsJa("R", "L")    ->  「/r/ が /l/ に聞こえました」
 *   heardAsJa("DH", "Z")   ->  「/ð/ が /z/ に聞こえました」
 *   heardAsJa("R", "ɾ")    ->  「/r/ が日本語のラ行の音に聞こえました」
 *   insertedVowelJa("UW")  ->  「/u/ が入っています」
 *   insertedVowelJa("ɯ")   ->  「日本語のウが入っています」
 *
 * Every unit, confusion and epenthetic vowel of both models has a label (checked by
 * tools/scoring-tests/scoring.test.mts).
 */
import { ipaChip, isEnglishPhone } from "./ipa.ts";

/** Japanese names of the sounds that are not English phonemes, and of the flap / glottal t. */
export const HEARD_LABELS: Record<string, string> = {
  DX: "はじく t",
  Q: "のどで止める t",
  "ɾ": "日本語のラ行の音",
  r: "巻き舌の音",
  "ʔ": "のどで止める音",
  "ɕ": "日本語のシ",
  "tɕ": "日本語のチ",
  "dʑ": "日本語のジ",
  ts: "日本語のツ",
  "ɸ": "日本語のフ",
  "β": "/b/ と /v/ の中間の音",
  "ç": "日本語のヒ",
  x: "のどの奥でこする音",
  "ɲ": "日本語のニ",
  a: "日本語のア",
  e: "日本語のエ",
  o: "日本語のオ",
  "ɯ": "日本語のウ",
  "aː": "日本語のアー",
  "eː": "日本語のエー",
  "oː": "日本語のオー",
  y: "くちびるを丸めたイ",
};

const JA = "\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef";
const LATIN_JA = new RegExp(`([^\\s${JA}])([${JA}])`, "gu");
const JA_LATIN = new RegExp(`([${JA}])([^\\s${JA}])`, "gu");
/** a space where Japanese meets a chip or other Latin text: 「/r/が/l/に」 → 「/r/ が /l/ に」 */
const spaced = (s: string) => s.replace(LATIN_JA, "$1 $2").replace(JA_LATIN, "$1 $2");

/** A heard sound: "/l/" for an English phone (stress digit respected: "AH0" → /ə/), else its Japanese name. */
export function heardLabel(symbol: string): string {
  const s = symbol.replace(/\?$/, "");
  if (isEnglishPhone(s)) return ipaChip(s);
  return HEARD_LABELS[s] ?? ipaChip(s);
}

/** 「<target> が <heard> に聞こえました」. An ARPAbet target ("R", "AH0") is written /r/, /ə/; anything else (a word, the UI's own text) as given. */
export function heardAsJa(target: string, heard: string): string {
  const t = isEnglishPhone(target) ? ipaChip(target) : target;
  return spaced(`${t}が${heardLabel(heard)}に聞こえました`);
}

/** 「<vowel> が入っています」. An inserted English vowel is short and weak: UW → /u/, AH → /ə/. */
export function insertedVowelJa(vowel: string): string {
  const v = vowel.replace(/[0-2]?\??$/, "");
  return spaced(`${isEnglishPhone(v) ? ipaChip(`${v}0`) : heardLabel(v)}が入っています`);
}
