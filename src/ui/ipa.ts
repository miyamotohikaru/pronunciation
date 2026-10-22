/**
 * Sounds are written one way everywhere: dictionary-style IPA, as Japanese English dictionaries
 * write American English (/ráɪs/, /ðə/, /hoʊtél/) — the stress as an accent over the vowel, no ˈ.
 * Each sound also has a short Japanese name for the line under its chip.
 *
 * Interim: derived here from the items' ARPAbet. When the data carries `ipa` (the scoring side is
 * adding it, with src/engine/scoring/ipa.ts for chips), lineIpa / wordIpa prefer it.
 */
import { HEARD_LABELS } from "@/engine/scoring/heard-labels.ts";

const VOWEL: Record<string, string> = {
  AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔː", AW: "aʊ", AY: "aɪ", EH: "e", ER: "əːr", EY: "eɪ",
  IH: "ɪ", IY: "iː", OW: "oʊ", OY: "ɔɪ", UH: "ʊ", UW: "uː",
};
/** unstressed forms that a dictionary writes differently (happy の y は短い /i/) */
const WEAK: Record<string, string> = { AH: "ə", ER: "ər", IY: "i" };
const CONS: Record<string, string> = {
  B: "b", CH: "tʃ", D: "d", DH: "ð", DX: "t", F: "f", G: "ɡ", HH: "h", JH: "dʒ", K: "k", L: "l", M: "m",
  N: "n", NG: "ŋ", P: "p", Q: "t", R: "r", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j",
  Z: "z", ZH: "ʒ",
};
const ACUTE = "́";
const GRAVE = "̀";

const isArpa = (s: string) => /^[A-Z]{1,2}[0-2]?$/.test(s);

/** one phone (ARPAbet, or one of the scorer's IPA units such as ɾ, ɯ) as IPA; stress marked on request */
export function phoneIpa(phone: string, stress = false): string {
  if (!isArpa(phone)) return phone; // already IPA (the student model's Japanese-like sounds)
  const base = phone.replace(/[0-2]$/, "");
  const d = phone.match(/([0-2])$/)?.[1];
  const v = VOWEL[base];
  if (!v) return CONS[base] ?? base.toLowerCase();
  const sym = d === "0" && WEAK[base] ? WEAK[base] : v;
  if (!stress || d === "0" || d === undefined) return sym;
  // the accent sits on the vowel's first letter: aɪ → áɪ
  return sym[0] + (d === "1" ? ACUTE : GRAVE) + sym.slice(1);
}

/** a word: /ráɪs/ (without the slashes). A one-syllable word carries a mark only for main stress. */
export function wordIpa(phones: string[]): string {
  const vowels = phones.filter((p) => /[0-2]$/.test(p)).length;
  return phones.map((p) => phoneIpa(p, !(vowels <= 1 && p.endsWith("2")))).join("");
}

/** a chip: /ð/ */
export function chipIpa(phone: string): string {
  return `/${phoneIpa(phone)}/`;
}

/** the whole line: /ðə ráɪs ɪz rédi/ — the data's own `ipa` first */
export function lineIpa(item: { words: { phones: string[] }[]; ipa?: string }): string {
  if (item.ipa) return item.ipa.startsWith("/") ? item.ipa : `/${item.ipa}/`;
  return `/${item.words.map((w) => wordIpa(w.phones)).join(" ")}/`;
}

/** the word as it was heard: one phone swapped (rice, R → L: /láɪs/) */
export function heardWordIpa(phones: string[], index: number, heard: string): string {
  const out = phones.map((p, i) => {
    if (i !== index) return phoneIpa(p, true);
    const d = p.match(/([0-2])$/)?.[1] ?? "";
    return phoneIpa(isArpa(heard) && VOWEL[heard.replace(/[0-2]$/, "")] && !/[0-2]$/.test(heard) ? heard + d : heard, true);
  });
  return out.join("");
}

/** short Japanese name under a chip */
const NAME: Record<string, string> = {
  R: "舌を引くR", L: "舌を付けるL", DH: "濁る th", TH: "息の th", Z: "ズ", S: "ス", SH: "シュ", ZH: "ジュ",
  D: "ド", T: "ト", V: "唇をかむヴ", F: "唇をかむフ", B: "ブ", P: "プ", HH: "ハ行", W: "ウ", Y: "ユ",
  N: "ン", M: "ム", NG: "鼻のン", K: "ク", G: "グ", CH: "チ", JH: "ジ",
  AE: "エに近いア", AH: "あいまいなア", AA: "大きく開くア", AO: "オー", AW: "アウ", AY: "アイ", EH: "エ",
  ER: "舌を丸めたアー", EY: "エイ", IH: "短いイ", IY: "長いイー", OW: "オウ", OY: "オイ", UH: "短いウ", UW: "長いウー",
  "ɾ": "日本語のラ行", r: "巻き舌", "ʔ": "のどで止める", "ɕ": "日本語のシ", "tɕ": "日本語のチ", "dʑ": "日本語のジ",
  ts: "ツ", "ɸ": "日本語のフ", "β": "BとVの間", "ç": "日本語のヒ", "ɲ": "日本語のニ", a: "日本語のア", e: "日本語のエ",
  o: "日本語のオ", "ɯ": "日本語のウ", "aː": "日本語のアー", "eː": "日本語のエー", "oː": "日本語のオー",
};
export function soundNameJa(phone: string): string {
  const base = isArpa(phone) ? phone.replace(/[0-2]$/, "") : phone;
  return NAME[base] ?? HEARD_LABELS[base] ?? base;
}
