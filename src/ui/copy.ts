/**
 * Words the game UI says. Short, warm, concrete. Breaks: ◇ = always, ◆ = phone only (BreakText).
 * Tips are written for Japanese mouths (what to do differently from ラ行 etc.), not translated.
 */
import type { PhoneScore, ProsodyNote, WordScore } from "./types";
import { heardAsJa, heardLabel, insertedVowelJa } from "@/engine/scoring/heard-labels.ts";

const base = (p: string) => p.replace(/[0-9]/g, "").toUpperCase();

/** How a sound is written in the UI by default: plain letters a Japanese adult can read. */
const LETTERS: Record<string, string> = {
  R: "r", L: "l", AY: "ai", IH: "i", IY: "ii", S: "s", Z: "z", K: "k", T: "t", D: "d", P: "p", B: "b",
  V: "v", F: "f", HH: "h", TH: "th", DH: "th", SH: "sh", N: "n", M: "m", NG: "ng", W: "w", Y: "y",
  AE: "a", AH: "a", AA: "a", ER: "er", OW: "ou", UW: "uu", UH: "u", EH: "e", EY: "ei", AO: "o",
  G: "g", CH: "ch", JH: "j", ZH: "zh", AW: "au", OY: "oi",
};
/** IPA, on demand only. */
const IPA: Record<string, string> = {
  R: "ɹ", L: "l", AY: "aɪ", IH: "ɪ", IY: "i", S: "s", Z: "z", K: "k", T: "t", D: "d", P: "p", B: "b",
  V: "v", F: "f", HH: "h", TH: "θ", DH: "ð", SH: "ʃ", N: "n", M: "m", NG: "ŋ", W: "w", Y: "j",
  AE: "æ", AH: "ʌ", AA: "ɑ", ER: "ɝ", OW: "oʊ", UW: "u", UH: "ʊ", EH: "ɛ", EY: "eɪ", AO: "ɔ",
  G: "ɡ", CH: "tʃ", JH: "dʒ", ZH: "ʒ", AW: "aʊ", OY: "ɔɪ",
};

export function soundLabel(phone: string): string {
  return LETTERS[base(phone)] ?? base(phone).toLowerCase();
}
export function soundIpa(phone: string): string {
  return `/${IPA[base(phone)] ?? base(phone).toLowerCase()}/`;
}

/** "r が l に聞こえました" */
/**
 * The one-line diagnosis for a learner, in plain Japanese. `target` is how the sound is spelled in
 * the word ("r", "th"); heard sounds come from the scorer's labels (ARPAbet or the student model's
 * IPA units) through src/engine/scoring/heard-labels.ts.
 */
export function diagnosisJa(p: PhoneScore, target: string): string | null {
  if (p.heardAs) return heardAsJa(target, p.heardAs);
  if (p.inserted) return `${target} のあとに${insertedVowelJa(p.inserted)}`;
  if (p.issue === "deletion") return `${target} が聞こえませんでした`;
  if (p.score < 60) return `${target} が少しあいまいでした`;
  return null;
}

export function heardLine(p: PhoneScore, label: (phone: string) => string = soundLabel): string | null {
  if (p.heardAs) return heardAsJa(label(p.phone), p.heardAs);
  if (p.inserted) return `${label(p.phone)} のあとに${insertedVowelJa(p.inserted)}`;
  if (p.issue === "deletion") return `${label(p.phone)} が聞こえませんでした`;
  if (p.score < 60) return `${label(p.phone)} が少しあいまいでした`;
  return null;
}

/** The other word of the minimal pair, by swapping the letters that spell the sound. */
export function heardWord(w: WordScore, p: PhoneScore): string | null {
  if (!p.heardAs || !p.letters) return null;
  if (!/^[A-Z]+[0-2]?$/.test(p.heardAs)) return null; // an IPA unit (日本語のラ行…) has no English spelling
  const [a, b] = p.letters;
  return w.text.slice(0, a) + soundLabel(p.heardAs) + w.text.slice(b);
}

/** short name of what was heard, for the end of the meter ("lice" or "日本語のラ行の音") */
export function heardShort(w: WordScore, p: PhoneScore): string | null {
  if (p.heardAs) return heardWord(w, p) ?? heardLabel(p.heardAs);
  if (p.inserted) return `${heardLabel(p.inserted)}入り`;
  return null;
}

/** one line: how to fix it (the item's own tip first, else the sound's first tip line) */
export function fixLineJa(phone: string, own: string | null): string | null {
  if (own) return own;
  const t = TIPS[base(phone)];
  return t ? t[0] : null;
}

/** one-line reading of the pitch chart, from compareProsody's issues */
export function chartReadingJa(notes: ProsodyNote[], words: string[]): string {
  const n = [...notes].sort((a, b) => b.weight - a.weight)[0];
  if (!n) return "高さの動きは、お手本に近いです。";
  const w = n.word !== undefined ? words[n.word] : undefined;
  switch (n.kind) {
    case "flat-intonation":
      return "高さの幅が小さく、平らに聞こえます。";
    case "contour-mismatch":
      return w ? `${w} の上がり下がりが、お手本と違います。` : "上がり下がりの形が、お手本と違います。";
    case "final-contour":
      return "文の終わりの上げ下げが、お手本と逆です。";
    case "equal-timing":
      return "どの音も同じ長さになっています。";
    case "weak-contrast":
      return "強い所と弱い所の差が、小さめです。";
    case "stress-misplaced":
      return w ? `${w} の強い所が、ずれています。` : "強い所が、ずれています。";
    case "pause":
      return w ? `${w} の前で、止まっています。` : "途中で、止まっています。";
    case "too-slow":
      return "お手本より、ゆっくりです。";
    case "too-fast":
      return "お手本より、速めです。";
  }
}

/** Two lines: where the tongue/lips go. Keyed by the target sound. */
const TIPS: Record<string, [string, string]> = {
  // what to do first; what not to do only after
  R: ["舌先を少し奥に引き、◆どこにも付けずに。", "唇を軽く丸めて言います。"],
  L: ["舌先を、◆上の前歯の付け根に付けます。", "付けたまま、◆声を出します。"],
  TH: ["舌先を、◆上の前歯に軽く当てます。", "すき間から、◆息だけを流します。"],
  DH: ["舌先を、◆上の前歯に軽く当てます。", "当てたまま、◆声をふるわせます。"],
  V: ["上の前歯を、◆下唇に軽くのせます。", "そのまま、◆声をふるわせます。"],
  F: ["上の前歯を、◆下唇に軽くのせます。", "すき間から、◆息を流します。"],
  IH: ["口の力を抜いて、◆短く「イ」と「エ」の間に。", "長くのばしません。"],
  IY: ["口を横に引いて、◆長めにのばします。", "「イー」をはっきり。"],
  AE: ["口を大きく横に開いて、◆「エ」の口で「ア」。", "あごをしっかり下げます。"],
  AH: ["口の力を抜いて、◆短く軽い「ア」。", "あごはあまり下げません。"],
  AA: ["口を縦に大きく開けて、◆のどの奥から「アー」。", "唇は丸めません。"],
  ER: ["舌を奥に引いて、◆少し丸めたまま「アー」。", "どこにも付けません。"],
  AY: ["「ア」から「イ」へ、◆なめらかに動かします。", "「ア」を長めに。"],
  S: ["舌先を、◆歯ぐきに近づけて息を流します。", "最後に母音を足しません。"],
  SH: ["唇を少し前に出して、◆「シュ」と息を流します。", "舌は歯ぐきから離します。"],
  T: ["舌先を歯ぐきに付けて、◆息で放します。", "「ト」の「オ」は足しません。"],
  D: ["舌先を歯ぐきに付けて、◆声を出して放します。", "「ド」の「オ」は足しません。"],
  K: ["のどの奥で息を止めて、◆一気に放します。", "「ク」の「ウ」は足しません。"],
};
export function mouthTip(phone: string): [string, string] | null {
  return TIPS[base(phone)] ?? null;
}

/** Which side-view diagram to show for a sound (only the ones we have drawn). */
export function mouthSound(phone: string): "r" | "l" | null {
  const b = base(phone);
  if (b === "R") return "r";
  if (b === "L") return "l";
  return null;
}

/** Prosody notes, said as the next thing to try. */
export function noteLine(n: ProsodyNote, words: string[]): string {
  const w = n.word !== undefined ? words[n.word] : undefined;
  switch (n.kind) {
    case "flat-intonation":
      return w ? `${w} の山を、◆もう少し高く。` : "高いところを、◆もう少し高く。";
    case "contour-mismatch":
      return w ? `${w} で、◆声の上げ下げをまねてみよう。` : "声の上げ下げを、◆まねてみよう。";
    case "final-contour":
      return "文の終わりで、◆声を下げます。";
    case "equal-timing":
      return "強いところを長く、◆弱いところを短く。";
    case "weak-contrast":
      return "強いところを、◆もっとはっきり。";
    case "stress-misplaced":
      return w ? `${w} は、◆強いところが違うかも。` : "強いところが、◆違うかも。";
    case "pause":
      return w ? `${w} の前で、◆止まらずに続けます。` : "止まらずに、◆続けて言います。";
    case "too-slow":
      return "もう少し、◆速くて大丈夫です。";
    case "too-fast":
      return "少しだけ、◆ゆっくりに。";
  }
}

export const STATUS = {
  listenIdle: "押して話す",
  recording: "聞いています",
  recordingHint: "言い終わると、自動で止まります",
  thinking: "お手本とくらべています",
};

/** a sound as a chip: /r/, /th/ — always the same shape; the student's Japanese-like sounds by their kana */
export function soundChip(symbol: string): string {
  if (/^[A-Z]+[0-2]?$/.test(symbol)) return `/${soundLabel(symbol)}/`;
  return heardLabel(symbol).replace(/^日本語の/, "").replace(/の音$/, "");
}

/** the fix line: our own positive-first tip, else the item's */
export function fixFor(phone: string, own: string | null): string | null {
  const t = TIPS[base(phone)];
  return t ? `${t[0]}${t[1] ? "◇" + t[1] : ""}` : own;
}

/** one imperative line for the pitch chart (after the take) */
export function chartTipJa(notes: ProsodyNote[], words: string[]): string {
  const n = [...notes].sort((a, b) => b.weight - a.weight)[0];
  if (!n) return "高さの動きは、このままで大丈夫です。";
  const w = n.word !== undefined ? words[n.word] : undefined;
  switch (n.kind) {
    case "flat-intonation":
      return "高い所を、もっと高く。";
    case "contour-mismatch":
      return w ? `${w} で、上げ下げをお手本に合わせる。` : "上げ下げを、お手本に合わせる。";
    case "final-contour":
      return "文の終わりで、もっと下げる。";
    case "equal-timing":
      return "強い音を長く、弱い音を短く。";
    case "weak-contrast":
      return "強い音を、もっとはっきり。";
    case "stress-misplaced":
      return w ? `${w} は、強く言う所を変える。` : "強く言う所を変える。";
    case "pause":
      return w ? `${w} の前で、止まらずに続ける。` : "止まらずに続ける。";
    case "too-slow":
      return "もう少し、速く。";
    case "too-fast":
      return "少しだけ、ゆっくり。";
  }
}
