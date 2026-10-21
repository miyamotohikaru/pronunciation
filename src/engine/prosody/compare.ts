import type { PhoneSpan, PitchFrame, ProsodyIssue, ProsodyResult, SyllableStats } from "./types.ts";
import { syllabify } from "./syllables.ts";
import { contour, speakerMedianHz, syllableStats, toRegions, warpToRef, type Region } from "./features.ts";
import { clamp, mean, pearson, quantile, slope } from "./stats.ts";

/** 1回ぶんの発話（お手本 or 自分）。phones は同じ目標音素列への強制アラインメント。 */
export type Take = {
  phones: PhoneSpan[];
  pitch: PitchFrame[];
  /** 声の出ていた区間（VAD など）。秒 */
  speech: [number, number];
};

/** 隣り合う音節の長さの揺れ（nPVI）。英語は大きく、モーラ拍の日本語は小さい。 */
function npvi(d: number[]): number {
  if (d.length < 2) return 0;
  let s = 0;
  for (let i = 0; i + 1 < d.length; i++) s += Math.abs(d[i] - d[i + 1]) / ((d[i] + d[i + 1]) / 2);
  return (100 * s) / (d.length - 1);
}

/** 末尾の約0.3秒の上がり下がり（半音/秒）。 */
function finalSlope(stats: SyllableStats[], points: { t: number; st: number | null }[]): number {
  if (stats.length === 0) return 0;
  const end = stats[stats.length - 1].end;
  const tail = points.filter((p) => p.st !== null && p.t >= end - 0.35 && p.t <= end);
  if (tail.length < 4) return 0;
  return slope(
    tail.map((p) => p.t),
    tail.map((p) => p.st as number),
  );
}

/** お手本にない長い間（250ms 以上）を数える。 */
function extraPauses(user: SyllableStats[], ref: SyllableStats[], userRegions: Region[]): { count: number; words: number[] } {
  void userRegions;
  let count = 0;
  const words: number[] = [];
  for (let i = 0; i + 1 < user.length; i++) {
    const gu = user[i + 1].nucleusStart - user[i].nucleusEnd;
    const gr = ref[i + 1].nucleusStart - ref[i].nucleusEnd;
    if (gu - gr > 0.25 && gu > 0.3) {
      count++;
      words.push(i + 1);
    }
  }
  return { count, words };
}

export function compareProsody(ref: Take, user: Take, words: string[]): ProsodyResult {
  const syllables = syllabify(ref.phones, words);
  const refRegions = toRegions(ref.phones, ref.speech[0], ref.speech[1]);
  const userRegions = toRegions(user.phones, user.speech[0], user.speech[1]);
  const refHz = speakerMedianHz(ref.pitch, ref.speech[0], ref.speech[1]);
  const userHz = speakerMedianHz(user.pitch, user.speech[0], user.speech[1]);
  const rs = syllableStats(syllables, refRegions, ref.pitch, refHz);
  const us = syllableStats(syllables, userRegions, user.pitch, userHz);
  const n = syllables.length;
  const detail: Record<string, number> = { syllables: n };
  const issues: ProsodyIssue[] = [];

  // ---- リズム ----
  // 音節全体の長さは子音の数で決まってしまう（お手本と自分で同じ）ので、
  // 強弱が表れる母音（核）の長さで比べる。
  const rDur = rs.map((s) => s.nucleusEnd - s.nucleusStart);
  const uDur = us.map((s) => s.nucleusEnd - s.nucleusStart);
  const rTotal = rDur.reduce((a, b) => a + b, 0);
  const uTotal = uDur.reduce((a, b) => a + b, 0);
  const rel = (d: number[], tot: number) => d.map((x) => Math.log(x / (tot / d.length)));
  const durCorr = pearson(rel(rDur, rTotal), rel(uDur, uTotal));
  const corrScore = Number.isNaN(durCorr) ? 0.6 : clamp(durCorr / 0.8);

  // お手本で目立っていた音節（上位4割）を「強」、残りを「弱」として、長さの比を比べる
  const cut = quantile(
    rs.map((s) => s.prominence),
    0.6,
  );
  const strong = rs.map((s) => s.prominence >= cut);
  const ratio = (d: number[]) => {
    const a = d.filter((_, i) => strong[i]);
    const b = d.filter((_, i) => !strong[i]);
    return a.length && b.length ? mean(a) / mean(b) : 1;
  };
  const rRatio = ratio(rDur);
  const uRatio = ratio(uDur);
  const contrastScore = n >= 2 ? 1 - Math.min(1, Math.abs(Math.log(uRatio / rRatio)) / Math.log(2)) : 1;

  const rPvi = npvi(rDur);
  const uPvi = npvi(uDur);
  const pviScore = n >= 3 ? 1 - Math.min(1, Math.abs(uPvi - rPvi) / 40) : 1;
  detail.durCorr = durCorr;
  detail.ratioRef = rRatio;
  detail.ratioUser = uRatio;
  detail.npviRef = rPvi;
  detail.npviUser = uPvi;

  const lowConfidence = n < 3;
  const rhythm = 100 * (lowConfidence ? 0.75 + 0.25 * contrastScore : clamp(0.4 * corrScore + 0.35 * contrastScore + 0.25 * pviScore));

  if (n >= 4 && uPvi < 0.65 * rPvi) issues.push({ kind: "equal-timing", weight: clamp((rPvi - uPvi) / Math.max(rPvi, 1)) });
  if (n >= 2 && contrastScore < 0.5) issues.push({ kind: "weak-contrast", weight: 1 - contrastScore });

  // ---- 単語の中の強勢 ----
  const stress: ProsodyResult["stress"] = [];
  const byWord = new Map<number, number[]>();
  syllables.forEach((s, i) => byWord.set(s.word, [...(byWord.get(s.word) ?? []), i]));
  for (const [w, idx] of byWord) {
    if (idx.length < 2) continue;
    const expected = idx.findIndex((i) => syllables[i].lexicalStress === 1);
    if (expected < 0) continue;
    const argmax = (st: SyllableStats[]) => idx.reduce((best, i, k) => (st[i].prominence > st[idx[best]].prominence ? k : best), 0);
    if (argmax(rs) !== expected) continue; // お手本自体が辞書どおりでなければ判定しない
    const got = argmax(us);
    stress.push({ word: w, expected, got, ok: got === expected });
    if (got !== expected) issues.push({ kind: "stress-misplaced", word: w, weight: 0.8 });
  }
  const stressScore = stress.length ? stress.filter((s) => s.ok).length / stress.length : 1;

  // ---- 抑揚 ----
  const pairs = rs.map((r, i) => [r.pitchSt, us[i].pitchSt] as const).filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null);
  const pitchCorr = pairs.length >= 3 ? pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1])) : NaN;
  const shapeScore = Number.isNaN(pitchCorr) ? 0.6 : clamp((pitchCorr + 0.2) / 0.9);
  // 相関は振れ幅を見ないので、音節ごとの高さの差（半音）でも比べる
  const pitchDist = pairs.length ? mean(pairs.map((p) => Math.abs(p[0] - p[1]))) : 0;
  const distScore = pairs.length ? 1 - Math.min(1, pitchDist / 2.5) : 0.6;
  const contourScore = 0.45 * shapeScore + 0.55 * distScore;
  const refC = contour(ref.pitch, refHz, ref.speech[0], ref.speech[1]);
  const userC = contour(user.pitch, userHz, user.speech[0], user.speech[1]);
  const range = (c: { st: number | null }[]) => {
    const v = c.map((p) => p.st).filter((x): x is number => x !== null);
    return v.length >= 5 ? quantile(v, 0.9) - quantile(v, 0.1) : 0;
  };
  const rRange = range(refC);
  const uRange = range(userC);
  const rangeScore = rRange < 2 ? (uRange < 6 ? 1 : 0.7) : uRange <= 0 ? 0 : 1 - Math.min(1, Math.abs(Math.log(uRange / rRange)) / Math.log(2.5));
  const rFinal = finalSlope(rs, refC);
  const uFinal = finalSlope(us, userC);
  const finalScore = Math.abs(rFinal) < 3 ? 1 : Math.sign(rFinal) === Math.sign(uFinal) && Math.abs(uFinal) >= 1.5 ? 1 : Math.sign(rFinal) === Math.sign(uFinal) ? 0.6 : 0;
  detail.pitchCorr = pitchCorr;
  detail.pitchDist = pitchDist;
  detail.rangeRef = rRange;
  detail.rangeUser = uRange;
  detail.finalRef = rFinal;
  detail.finalUser = uFinal;

  const intonation = 100 * (lowConfidence ? clamp(0.6 * rangeScore + 0.4 * finalScore) : clamp(0.65 * contourScore + 0.2 * rangeScore + 0.1 * finalScore + 0.05 * stressScore));
  if (rRange >= 2 && uRange < 0.6 * rRange) issues.push({ kind: "flat-intonation", weight: clamp(1 - uRange / rRange) });
  if (!lowConfidence && contourScore < 0.45) issues.push({ kind: "contour-mismatch", weight: 1 - contourScore });
  if (finalScore === 0) issues.push({ kind: "final-contour", word: syllables[n - 1]?.word, weight: 0.9 });

  // ---- 間と速さ ----
  const pauses = n >= 2 ? extraPauses(us, rs, userRegions) : { count: 0, words: [] };
  const rSpan = rs.length ? rs[rs.length - 1].end - rs[0].start : 0;
  const uSpan = us.length ? us[us.length - 1].end - us[0].start : 0;
  const pace = rSpan > 0 ? uSpan / rSpan : 1;
  let fluency = 100 - 15 * pauses.count;
  if (pace > 1.45) fluency -= Math.min(40, (pace - 1.45) * 60);
  if (pace < 0.72) fluency -= Math.min(30, (0.72 - pace) * 90);
  fluency = clamp(fluency, 0, 100);
  detail.pace = pace;
  detail.pauses = pauses.count;
  for (const w of pauses.words) issues.push({ kind: "pause", word: syllables[w]?.word, weight: 0.5 });
  if (pace > 1.6) issues.push({ kind: "too-slow", weight: clamp((pace - 1.6) / 1.2) });
  if (pace < 0.7) issues.push({ kind: "too-fast", weight: clamp((0.7 - pace) / 0.4) });

  issues.sort((a, b) => b.weight - a.weight);
  return {
    rhythm: Math.round(rhythm),
    intonation: Math.round(intonation),
    fluency: Math.round(fluency),
    lowConfidence,
    syllables,
    ref: rs,
    user: us,
    stress,
    userOnRefTime: warpToRef(userC, userRegions, refRegions),
    refContour: refC,
    issues,
    detail,
  };
}
