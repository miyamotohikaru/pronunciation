import type { PhoneSpan, PitchFrame, ProsodyIssue, ProsodyResult, Syllable, SyllableStats } from "./types.ts";
import { syllabify } from "./syllables.ts";
import { contour, speakerMedianHz, syllableStats, toRegions, warpByKnots, type Region } from "./features.ts";
import { clamp, mean, median, pearson, quantile } from "./stats.ts";

/** 1回ぶんの発話（お手本 or 自分）。phones は同じ目標音素列への強制アラインメント。 */
export type Take = {
  phones: PhoneSpan[];
  pitch: PitchFrame[];
  /** 声の出ていた区間（VAD など）。秒 */
  speech: [number, number];
};

/**
 * 生の点（0..100）→ 見せる点（0..100）の換算表。[生, 見せる] を区分線形でつなぐ。
 * 2026-10-22 に、お手本の2声（af_heart / am_michael）どうしを比べた分布で合わせた。
 * ネイティブどうしの下位1割（文 56）が 82、中央値（文 73）が 92 になり、
 * 棒読み（高さを一定にした声。文の中央値 23）は 45 前後に下がる。
 * 1〜2音節の語は形の比較が不安定なので、別の表で甘めにする。
 */
export const INTONATION_CURVE: readonly (readonly [number, number])[] = [[0, 0], [25, 45], [56, 82], [73, 92], [85, 98], [100, 100]];
export const INTONATION_CURVE_SHORT: readonly (readonly [number, number])[] = [[0, 0], [20, 45], [45, 80], [85, 95], [100, 100]];
/** リズム: ネイティブどうしの文の下位1割 73 → 85、中央値 90 → 95。 */
export const RHYTHM_CURVE: readonly (readonly [number, number])[] = [[0, 0], [40, 45], [73, 85], [90, 95], [100, 100]];

export function curve(raw: number, table: readonly (readonly [number, number])[]): number {
  const x = clamp(raw, 0, 100);
  for (let i = 0; i + 1 < table.length; i++) {
    const [x0, y0] = table[i];
    const [x1, y1] = table[i + 1];
    if (x <= x1) return y0 + ((x - x0) / Math.max(1e-9, x1 - x0)) * (y1 - y0);
  }
  return table[table.length - 1][1];
}

/** 隣り合う音節の長さの揺れ（nPVI）。英語は大きく、モーラ拍の日本語は小さい。 */
function npvi(d: number[]): number {
  if (d.length < 2) return 0;
  let s = 0;
  for (let i = 0; i + 1 < d.length; i++) s += Math.abs(d[i] - d[i + 1]) / ((d[i] + d[i + 1]) / 2);
  return (100 * s) / (d.length - 1);
}

/**
 * 文末の上がり下がり（半音/秒）。最後の音節の母音（核）の終わりまでを見る。
 * 語末の子音（t の破裂など）で音程の読み取りが跳ねる所は入れない。
 * 1フレームの跳ねは3点の中央値で消し、傾きは外れ値に強い Theil–Sen（2点ずつの傾きの中央値）で出して ±40 に収める。
 */
function finalSlope(stats: SyllableStats[], points: { t: number; st: number | null }[]): number {
  if (stats.length === 0) return 0;
  const last = stats[stats.length - 1];
  const end = last.nucleusEnd + 0.03;
  const start = Math.max(last.nucleusStart - 0.2, end - 0.35);
  const raw = points.filter((p): p is { t: number; st: number } => p.st !== null && p.t >= start && p.t <= end);
  if (raw.length < 5) return 0;
  const st = raw.map((p, i) => median([raw[Math.max(0, i - 1)].st, p.st, raw[Math.min(raw.length - 1, i + 1)].st]));
  const slopes: number[] = [];
  for (let i = 0; i < raw.length; i++) for (let j = i + 3; j < raw.length; j++) slopes.push((st[j] - st[i]) / (raw[j].t - raw[i].t));
  if (slopes.length === 0) return 0;
  return clamp(median(slopes), -40, 40);
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

/**
 * お手本と自分の音節を単語ごとに組にする。
 * 採点器はテイクごとに読みを選ぶ（弱い母音を省いた読みなど）ので、音素の数は一致しない。
 * 単語の中の音節の数が同じなら順に、違えば位置の割合で対応させる（重複はしない）。
 */
export function pairSyllables(ref: Syllable[], user: Syllable[]): [number, number][] {
  const byWord = (xs: Syllable[]) => {
    const m = new Map<number, number[]>();
    xs.forEach((x, i) => m.set(x.word, [...(m.get(x.word) ?? []), i]));
    return m;
  };
  const rw = byWord(ref);
  const uw = byWord(user);
  const out: [number, number][] = [];
  for (const [w, ri] of rw) {
    const ui = uw.get(w);
    if (!ui || ui.length === 0) continue;
    if (ri.length === ui.length) {
      ri.forEach((r, k) => out.push([r, ui[k]]));
      continue;
    }
    const used = new Set<number>();
    ri.forEach((r, k) => {
      const pos = ri.length === 1 ? 0 : k / (ri.length - 1);
      const u = ui[Math.round(pos * (ui.length - 1))];
      if (!used.has(u)) {
        used.add(u);
        out.push([r, u]);
      }
    });
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export function compareProsody(ref: Take, user: Take, words: string[]): ProsodyResult {
  const refSyl = syllabify(ref.phones, words);
  const userSyl = syllabify(user.phones, words);
  const sylPairs = pairSyllables(refSyl, userSyl);
  const refRegions = toRegions(ref.phones, ref.speech[0], ref.speech[1]);
  const userRegions = toRegions(user.phones, user.speech[0], user.speech[1]);
  const refHz = speakerMedianHz(ref.pitch, ref.speech[0], ref.speech[1]);
  const userHz = speakerMedianHz(user.pitch, user.speech[0], user.speech[1]);
  const rsAll = syllableStats(refSyl, refRegions, ref.pitch, refHz);
  const usAll = syllableStats(userSyl, userRegions, user.pitch, userHz);
  // ここから先は組になった音節だけを並べて比べる
  const syllables = sylPairs.map(([r]) => refSyl[r]);
  const rs = sylPairs.map(([r]) => rsAll[r]);
  const us = sylPairs.map(([, u]) => usAll[u]);
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
  // 1〜2音節の語は文末の傾きが不安定なので、はっきり動くときだけ比べる
  const finalScore = Math.abs(rFinal) < (lowConfidence ? 8 : 3) ? 1 : Math.sign(rFinal) === Math.sign(uFinal) && Math.abs(uFinal) >= 1.5 ? 1 : Math.sign(rFinal) === Math.sign(uFinal) ? 0.6 : 0;
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
  detail.rawRhythm = rhythm;
  detail.rawIntonation = intonation;
  return {
    rhythm: Math.round(curve(rhythm, RHYTHM_CURVE)),
    intonation: Math.round(curve(intonation, lowConfidence ? INTONATION_CURVE_SHORT : INTONATION_CURVE)),
    fluency: Math.round(fluency),
    lowConfidence,
    syllables,
    ref: rs,
    user: us,
    stress,
    userOnRefTime: warpByKnots(userC, rs.flatMap((r, i) => [[us[i].start, r.start], [us[i].nucleusStart, r.nucleusStart], [us[i].nucleusEnd, r.nucleusEnd], [us[i].end, r.end]] as [number, number][])),
    refContour: refC,
    issues,
    detail,
  };
}
