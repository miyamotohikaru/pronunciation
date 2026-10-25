/**
 * Words the game UI says. Short, warm, concrete. Breaks: ◇ = always, ◆ = phone only (BreakText).
 * Tips are written for Japanese mouths (what to do differently from ラ行 etc.), not translated.
 */
import type { PhoneScore, ProsodyNote, WordScore } from "./types";
import { heardAsJa, heardLabel, insertedVowelJa } from "@/engine/scoring/heard-labels.ts";
import { ipaChip } from "@/engine/scoring/ipa.ts";

const base = (p: string) => p.replace(/[0-9]/g, "").toUpperCase();

/**
 * Spelling only — the letters that usually write a sound, to spell the word it was heard as
 * (rice with R → L: "lice"). Never shown as a sound: sounds are written in IPA (src/engine/scoring/ipa.ts).
 */
const SPELLING: Record<string, string> = {
  R: "r", L: "l", AY: "i", IH: "i", IY: "ee", S: "s", Z: "z", K: "k", T: "t", D: "d", P: "p", B: "b",
  V: "v", F: "f", HH: "h", TH: "th", DH: "th", SH: "sh", N: "n", M: "m", NG: "ng", W: "w", Y: "y",
  AE: "a", AH: "u", AA: "o", ER: "er", OW: "o", UW: "oo", UH: "oo", EH: "e", EY: "a", AO: "o",
  G: "g", CH: "ch", JH: "j", ZH: "s", AW: "ou", OY: "oy",
};

/** how a sound is spelled (for building a word); for showing a sound use ipaChip */
export function soundLabel(phone: string): string {
  return SPELLING[base(phone)] ?? base(phone).toLowerCase();
}
/** a sound as shown: dictionary IPA (/ð/) */
export const soundIpa = ipaChip;

/**
 * The one-line diagnosis for a learner, in plain Japanese, in the app's one notation: the target
 * and the heard sound go to heard-labels.ts as ARPAbet (or the student model's units), which
 * writes them /ð/, /z/, or by a Japanese name for the sounds no dictionary has a symbol for.
 */
export function diagnosisJa(p: PhoneScore): string | null {
  return heardLine(p);
}

export function heardLine(p: PhoneScore): string | null {
  if (p.heardAs) return heardAsJa(p.phone, p.heardAs);
  if (p.inserted) return `${ipaChip(p.phone)} のあとに${insertedVowelJa(p.inserted)}`;
  if (p.issue === "deletion") return `${ipaChip(p.phone)} が聞こえませんでした`;
  if (p.score < 60) return `${ipaChip(p.phone)} が少しあいまいでした`;
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


/** the fix line: our own positive-first tip, else the item's */
export function fixFor(phone: string, own: string | null): string | null {
  const t = TIPS[base(phone)];
  return t ? `${t[0]}${t[1] ? "◇" + t[1] : ""}` : own;
}

/**
 * The sound card's two steps, ① ②: what to do, in the same form (each ends on its verb, the verb
 * in **bold**); what the picture already says (✕ 付けない) is not written again.
 */
const STEPS: Record<string, [string, string]> = {
  R: ["舌先を少し奥へ**引く**", "唇を軽く**丸める**"],
  L: ["舌先を上の歯ぐきに**付ける**", "付けたまま声を**出す**"],
  TH: ["舌先を上の前歯に軽く**当てる**", "すき間から息だけを**流す**"],
  DH: ["舌先を上の前歯に軽く**当てる**", "当てたまま声を**ふるわせる**"],
  V: ["上の前歯を下唇に軽く**のせる**", "そのまま声を**ふるわせる**"],
  F: ["上の前歯を下唇に軽く**のせる**", "すき間から息を**流す**"],
  IH: ["口の力を抜いて短く**言う**", "「イ」と「エ」の間の音に**する**"],
  IY: ["口を横に**引く**", "長めに**のばす**"],
  AE: ["口を大きく横に**開く**", "「エ」の口のまま「ア」と**言う**"],
  AH: ["口の力を**抜く**", "短く軽く「ア」と**言う**"],
  AA: ["口を縦に大きく**開ける**", "のどの奥から「アー」と**言う**"],
  ER: ["舌を奥に**引く**", "少し丸めたまま「アー」と**言う**"],
  AY: ["「ア」から「イ」へなめらかに**動かす**", "「ア」を長めに**言う**"],
  S: ["舌先を歯ぐきに**近づける**", "すき間から息を**流す**"],
  SH: ["唇を少し前に**出す**", "「シュ」と息を**流す**"],
  T: ["舌先を歯ぐきに**付ける**", "息で**放す**"],
  D: ["舌先を歯ぐきに**付ける**", "声を出して**放す**"],
  K: ["のどの奥で息を**止める**", "一気に**放す**"],
};
export function stepsFor(phone: string, own: string | null): string[] {
  const t = STEPS[base(phone)];
  if (t) return [...t];
  return own ? own.split("◇").map((x) => x.replace(/◆/g, "")) : [];
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
