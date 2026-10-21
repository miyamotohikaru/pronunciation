/**
 * Short plain-Japanese names for everything the scorer can report as `heardAs` or as an
 * inserted vowel: the ARPAbet phones and the student model's Japanese-like sounds (IPA
 * unit names in public/models/student-ipa/meta.json). For the result card:
 *
 *   heardAsJa("R", "ɾ")  ->  「R が日本語のラ行の音に聞こえました」
 *   insertedVowelJa("ɯ") ->  「日本語のウ が入っています」
 *
 * Every unit, confusion and epenthetic vowel of both models has an entry (checked by
 * tools/scoring-tests/scoring.test.mts).
 */

export const HEARD_LABELS: Record<string, string> = {
  // English consonants (ARPAbet)
  B: "B（ブ）",
  CH: "CH（チ）",
  D: "D（ドゥ）",
  DH: "this の TH（濁る th）",
  F: "F（下くちびるをかむフ）",
  G: "G（グ）",
  HH: "H（ハ行の音）",
  JH: "J（ジュ）",
  K: "K（ク）",
  L: "L",
  M: "M（ム）",
  N: "N（舌先で止めるン）",
  NG: "NG（鼻に抜けるン）",
  P: "P（プ）",
  R: "R",
  S: "S（スー）",
  SH: "SH（シュ）",
  T: "T（トゥ）",
  TH: "TH（舌をかむス）",
  V: "V（下くちびるをかむヴ）",
  W: "W（ウ）",
  Y: "Y（ユ）",
  Z: "Z（ズー）",
  ZH: "ZH（measure のジュ）",
  // English vowels (ARPAbet)
  AA: "口を大きく開けるア",
  AE: "エに近いア（æ）",
  AH: "短くあいまいなア",
  AO: "オー（ɔ）",
  AW: "アウ",
  AY: "アイ",
  EH: "エ",
  ER: "舌を丸めたアー（ɚ）",
  EY: "エイ",
  IH: "短いイ（ɪ）",
  IY: "長いイー",
  OW: "オウ",
  OY: "オイ",
  UH: "短いウ（ʊ）",
  UW: "長いウー",
  // target-only symbols (flap / glottal T)
  DX: "はじく T（water の t）",
  Q: "のどで止める T",
  // the student's Japanese-like and other L1 sounds (IPA unit names)
  "ɾ": "日本語のラ行の音",
  r: "巻き舌の R",
  "ʔ": "のどで止める音",
  "ɕ": "日本語のシ",
  "tɕ": "日本語のチ",
  "dʑ": "日本語のジ",
  ts: "ツ",
  "ɸ": "日本語のフ",
  "β": "B と V の中間の音",
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
  y: "くちびるを丸めたユ（ü）",
};

/** Label for a phone / unit symbol; stress digits are ignored ("AY1" = "AY"). */
export function heardLabel(symbol: string): string {
  return HEARD_LABELS[symbol] ?? HEARD_LABELS[symbol.replace(/[0-2]$/, "")] ?? symbol;
}

/** 「<target> が<heard>に聞こえました」. target is shown as given (e.g. "R", or the UI's own spelling). */
export function heardAsJa(target: string, heard: string): string {
  return `${target.replace(/[0-2]$/, "")} が${heardLabel(heard)}に聞こえました`;
}

/** 「<vowel> が入っています」 for an inserted vowel. */
export function insertedVowelJa(vowel: string): string {
  return `${heardLabel(vowel)} が入っています`;
}
