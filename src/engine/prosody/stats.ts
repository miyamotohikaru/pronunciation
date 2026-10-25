export const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((p, q2) => p - q2);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

/** ピアソンの相関。ばらつきが無いときは NaN を返す（呼ぶ側で扱いを決める）。 */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  if (saa < 1e-12 || sbb < 1e-12) return NaN;
  return sab / Math.sqrt(saa * sbb);
}

/** z 化。ばらつきが無ければ全部 0。 */
export function zscores(xs: number[]): number[] {
  const m = mean(xs);
  const s = std(xs);
  return s < 1e-9 ? xs.map(() => 0) : xs.map((x) => (x - m) / s);
}

/** 最小二乗の傾き（y / x）。 */
export function slope(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  }
  return sxx < 1e-12 ? 0 : sxy / sxx;
}

export const toDb = (rms: number) => 20 * Math.log10(Math.max(rms, 1e-6));
export const semitones = (f0: number, refHz: number) => 12 * Math.log2(f0 / refHz);
