/**
 * Words the game UI says. Short, warm, concrete. Breaks: ◇ = always, ◆ = phone only (BreakText).
 * Tips are written for Japanese mouths (what to do differently from ラ行 etc.), not translated.
 */
import type { PhoneScore, ProsodyNote, WordScore } from "./types";

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
export function heardLine(p: PhoneScore, label: (phone: string) => string = soundLabel): string | null {
  if (p.heardAs) return `${label(p.phone)} が ${label(p.heardAs)} に聞こえました`;
  if (p.issue === "deletion") return `${label(p.phone)} が聞こえませんでした`;
  if (p.score < 60) return `${label(p.phone)} が少しあいまいでした`;
  return null;
}

/** The other word of the minimal pair, by swapping the letters that spell the sound. */
export function heardWord(w: WordScore, p: PhoneScore): string | null {
  if (!p.heardAs || !p.letters) return null;
  const [a, b] = p.letters;
  return w.text.slice(0, a) + soundLabel(p.heardAs) + w.text.slice(b);
}

/** Two lines: where the tongue/lips go. Keyed by the target sound. */
const TIPS: Record<string, [string, string]> = {
  R: ["舌先は、◆どこにも付けません。", "唇を少し丸めて、◆「ゥ」から入ります。"],
  L: ["舌先を、◆上の歯の裏に付けます。", "付けたまま、◆声を出します。"],
  TH: ["舌先を、◆上の歯に軽く当てます。", "すき間から、◆息だけを流します。"],
  DH: ["舌先を、◆上の歯に軽く当てます。", "当てたまま、◆声をふるわせます。"],
  V: ["上の歯を、◆下唇に軽くのせます。", "そのまま、◆声をふるわせます。"],
  IH: ["「イ」より、◆口の力を抜きます。", "短く、◆少し「エ」寄りに。"],
  AY: ["「ア」から「イ」へ、◆なめらかに。", "「ア」を長めにします。"],
  S: ["舌先を、◆歯ぐきに近づけます。", "母音を足さずに、◆息で終わります。"],
  K: ["のどの奥で、◆息を止めて放します。", "「ク」の「ウ」は、◆足しません。"],
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
