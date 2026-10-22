/**
 * One judgement per word, from the judge's finalized syllables: what the lane pops above the
 * word (PERFECT / GREAT / もう一歩) and what the practice screen buzzes for. null until every
 * syllable of the word is final.
 */
import type { BarLive, GuideBar } from "@/engine/karaoke/judge.ts";

export type WordGrade = "perfect" | "great" | "near";

const POINTS = { perfect: 3, great: 2, good: 1, miss: 0 } as const;

export function wordGrade(bars: readonly BarLive[], syllables: readonly GuideBar[], word: number): { grade: WordGrade; late: boolean } | null {
  let n = 0;
  let sum = 0;
  let late = false;
  for (let i = 0; i < syllables.length; i++) {
    if (syllables[i].word !== word) continue;
    const g = bars[i]?.grade;
    if (!g) return null;
    n++;
    sum += POINTS[g];
    if (bars[i].timing === "late") late = true;
  }
  if (!n) return null;
  const m = sum / n;
  return { grade: m >= 2.6 ? "perfect" : m >= 1.6 ? "great" : "near", late };
}

export const WORD_GRADE_LABEL: Record<WordGrade, string> = { perfect: "PERFECT", great: "GREAT", near: "もう一歩" };
