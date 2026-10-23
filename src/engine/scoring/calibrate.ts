/**
 * Score scales. The regressor speaks speechocean762 (0 wrong .. 2 correct); the app shows
 * 0..100. A word is the mean of its sounds, capped at its worst sound + a margin, so one
 * clearly wrong sound (or an inserted vowel) fails a word of any length while a native's
 * occasional weak phone does not.
 */

/** Piecewise-linear map through knots [x, y] (x ascending), clamped to the end knots. */
export function calibrate(raw: number, knots: [number, number][]): number {
  if (!knots.length) return raw;
  if (raw <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i];
    if (raw <= x1) {
      const [x0, y0] = knots[i - 1];
      return y0 + ((raw - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return knots[knots.length - 1][1];
}

export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * A word: mean of its phone scores plus one pseudo-phone (insertionScore) per inserted
 * vowel, never more than the lowest of them + worstMargin.
 */
export function wordScore(phoneScores: number[], insertions: number, insertionScore: number, worstMargin = 20): number {
  const all = phoneScores.concat(new Array(insertions).fill(insertionScore));
  if (!all.length) return 0;
  return Math.min(mean(all), Math.min(...all) + worstMargin);
}

/** The take: word scores weighted by their number of sounds (inserted vowels included). */
export function takeScore(words: { score: number; sounds: number }[]): number {
  let s = 0;
  let n = 0;
  for (const w of words) {
    s += w.score * w.sounds;
    n += w.sounds;
  }
  return n ? s / n : 0;
}

export const round1 = (x: number) => Math.round(x * 10) / 10;
