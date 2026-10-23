/**
 * Numbers the result screen shows. The total is always the visible sum of named parts
 * (JOYSOUND model), to three decimals (DAM), so "one more" always moves it.
 */
import type { Judgement, PhoneScore, Scores } from "./types";

export type PartKey = "sounds" | "rhythm" | "intonation";

/** Points each part can earn. They add up to 100. */
export const WEIGHTS: Record<PartKey, number> = { sounds: 50, rhythm: 25, intonation: 25 };

export const PART_LABEL: Record<PartKey, string> = { sounds: "音", rhythm: "リズム", intonation: "抑揚" };

export type Part = { key: PartKey; label: string; points: number; max: number; score: number };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function parts(s: Scores): Part[] {
  return (Object.keys(WEIGHTS) as PartKey[]).map((key) => ({
    key,
    label: PART_LABEL[key],
    max: WEIGHTS[key],
    score: s[key],
    points: r3((s[key] / 100) * WEIGHTS[key]),
  }));
}

/** The total shown is the sum of the shown parts, never a separate number. */
export function total(s: Scores): number {
  return r3(parts(s).reduce((a, p) => a + p.points, 0));
}

export function fmt3(n: number): string {
  return n.toFixed(3);
}

/** Word / sound judgement (rhythm-game grammar, partial credit, never a fail). */
export function judge(score: number): Judgement {
  if (score >= 90) return "perfect";
  if (score >= 75) return "great";
  if (score >= 60) return "good";
  return "almost";
}

export const JUDGEMENT_LABEL: Record<Judgement, string> = {
  perfect: "PERFECT",
  great: "GREAT",
  good: "GOOD",
  almost: "もう一息",
};

export const JUDGEMENT_VAR: Record<Judgement, string> = {
  perfect: "var(--j-perfect)",
  great: "var(--j-great)",
  good: "var(--j-good)",
  almost: "var(--j-almost)",
};

/** Mark under each sound of the line: shape carries the meaning, colour only repeats it. */
export type Mark = "hit" | "near" | "miss";
export function mark(p: PhoneScore): Mark {
  if (p.heardAs || p.inserted || p.issue === "deletion" || p.score < 60) return "miss";
  if (p.score < 80) return "near";
  return "hit";
}

/** One word for the whole take. Warm, factual, never a verdict on the person. */
export function verdict(totalScore: number): string {
  if (totalScore >= 95) return "パーフェクト";
  if (totalScore >= 90) return "お手本にそっくり";
  if (totalScore >= 75) return "いい感じ";
  if (totalScore >= 60) return "伝わります";
  return "ここから伸びます";
}

/** Retry is the main button until the line reaches GREAT. */
export const RETRY_FIRST_BELOW = 75;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** -1 (ゆっくり) … 0 (お手本) … +1 (早口) */
export function tempoPosition(ratio: number): number {
  return clamp(-Math.log2(ratio) * 3, -1, 1);
}
/** -1 (平坦) … 0 (お手本) … +1 (大げさ) */
export function rangePosition(ratio: number): number {
  return clamp(Math.log2(ratio), -1, 1);
}
/** DAM-style 7 steps: -3 … +3 */
export function step7(pos: number): number {
  return Math.round(clamp(pos, -1, 1) * 3);
}
