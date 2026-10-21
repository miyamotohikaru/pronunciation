/**
 * Mixed-radix complex FFT (a port of KISS FFT's decimation-in-time recursion).
 * Works for any length; radix 2, 3, 4 and 5 have dedicated butterflies (whisper's
 * n_fft = 400 = 4 * 4 * 5 * 5). Float64 throughout.
 */

export type FftPlan = {
  n: number;
  /** [p0, m0, p1, m1, ...] radix and remaining length per stage (kf_factor). */
  factors: number[];
  twRe: Float64Array;
  twIm: Float64Array;
  scratchRe: Float64Array;
  scratchIm: Float64Array;
};

function factorize(n: number): number[] {
  const out: number[] = [];
  let p = 4;
  const floorSqrt = Math.floor(Math.sqrt(n));
  do {
    while (n % p) {
      if (p === 4) p = 2;
      else if (p === 2) p = 3;
      else p += 2;
      if (p > floorSqrt) p = n;
    }
    n /= p;
    out.push(p, n);
  } while (n > 1);
  return out;
}

export function makeFftPlan(n: number): FftPlan {
  const twRe = new Float64Array(n);
  const twIm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const phase = (-2 * Math.PI * i) / n;
    twRe[i] = Math.cos(phase);
    twIm[i] = Math.sin(phase);
  }
  const maxP = Math.max(...factorize(n).filter((_, i) => i % 2 === 0));
  return { n, factors: factorize(n), twRe, twIm, scratchRe: new Float64Array(maxP), scratchIm: new Float64Array(maxP) };
}

/** Forward FFT: out[k] = sum_j in[j] * exp(-2*pi*i*j*k/n). in and out must not overlap. */
export function fft(plan: FftPlan, inRe: Float64Array, inIm: Float64Array, outRe: Float64Array, outIm: Float64Array): void {
  work(plan, outRe, outIm, 0, inRe, inIm, 0, 1, 0);
}

function work(
  st: FftPlan,
  oRe: Float64Array,
  oIm: Float64Array,
  fout: number,
  iRe: Float64Array,
  iIm: Float64Array,
  f: number,
  fstride: number,
  fi: number,
): void {
  const p = st.factors[fi];
  const m = st.factors[fi + 1];
  const end = fout + p * m;
  if (m === 1) {
    for (let o = fout; o < end; o++) {
      oRe[o] = iRe[f];
      oIm[o] = iIm[f];
      f += fstride;
    }
  } else {
    for (let o = fout; o < end; o += m) {
      work(st, oRe, oIm, o, iRe, iIm, f, fstride * p, fi + 2);
      f += fstride;
    }
  }
  if (p === 2) bfly2(st, oRe, oIm, fout, fstride, m);
  else if (p === 3) bfly3(st, oRe, oIm, fout, fstride, m);
  else if (p === 4) bfly4(st, oRe, oIm, fout, fstride, m);
  else if (p === 5) bfly5(st, oRe, oIm, fout, fstride, m);
  else bflyGeneric(st, oRe, oIm, fout, fstride, m, p);
}

function bfly2(st: FftPlan, re: Float64Array, im: Float64Array, fo: number, fstride: number, m: number): void {
  const { twRe, twIm } = st;
  for (let u = 0, tw = 0; u < m; u++, tw += fstride) {
    const a = fo + u;
    const b = a + m;
    const tr = re[b] * twRe[tw] - im[b] * twIm[tw];
    const ti = re[b] * twIm[tw] + im[b] * twRe[tw];
    re[b] = re[a] - tr;
    im[b] = im[a] - ti;
    re[a] += tr;
    im[a] += ti;
  }
}

function bfly3(st: FftPlan, re: Float64Array, im: Float64Array, fo: number, fstride: number, m: number): void {
  const { twRe, twIm } = st;
  const epi3i = twIm[fstride * m];
  const m2 = 2 * m;
  for (let u = 0; u < m; u++) {
    const a = fo + u;
    const t1 = u * fstride;
    const t2 = 2 * u * fstride;
    const s1r = re[a + m] * twRe[t1] - im[a + m] * twIm[t1];
    const s1i = re[a + m] * twIm[t1] + im[a + m] * twRe[t1];
    const s2r = re[a + m2] * twRe[t2] - im[a + m2] * twIm[t2];
    const s2i = re[a + m2] * twIm[t2] + im[a + m2] * twRe[t2];
    const s3r = s1r + s2r;
    const s3i = s1i + s2i;
    let s0r = s1r - s2r;
    let s0i = s1i - s2i;
    const fmr = re[a] - s3r * 0.5;
    const fmi = im[a] - s3i * 0.5;
    s0r *= epi3i;
    s0i *= epi3i;
    re[a] += s3r;
    im[a] += s3i;
    re[a + m2] = fmr + s0i;
    im[a + m2] = fmi - s0r;
    re[a + m] = fmr - s0i;
    im[a + m] = fmi + s0r;
  }
}

function bfly4(st: FftPlan, re: Float64Array, im: Float64Array, fo: number, fstride: number, m: number): void {
  const { twRe, twIm } = st;
  const m2 = 2 * m;
  const m3 = 3 * m;
  for (let u = 0; u < m; u++) {
    const a = fo + u;
    const t1 = u * fstride;
    const t2 = 2 * u * fstride;
    const t3 = 3 * u * fstride;
    const s0r = re[a + m] * twRe[t1] - im[a + m] * twIm[t1];
    const s0i = re[a + m] * twIm[t1] + im[a + m] * twRe[t1];
    const s1r = re[a + m2] * twRe[t2] - im[a + m2] * twIm[t2];
    const s1i = re[a + m2] * twIm[t2] + im[a + m2] * twRe[t2];
    const s2r = re[a + m3] * twRe[t3] - im[a + m3] * twIm[t3];
    const s2i = re[a + m3] * twIm[t3] + im[a + m3] * twRe[t3];
    const s5r = re[a] - s1r;
    const s5i = im[a] - s1i;
    const f0r = re[a] + s1r;
    const f0i = im[a] + s1i;
    const s3r = s0r + s2r;
    const s3i = s0i + s2i;
    const s4r = s0r - s2r;
    const s4i = s0i - s2i;
    re[a + m2] = f0r - s3r;
    im[a + m2] = f0i - s3i;
    re[a] = f0r + s3r;
    im[a] = f0i + s3i;
    re[a + m] = s5r + s4i;
    im[a + m] = s5i - s4r;
    re[a + m3] = s5r - s4i;
    im[a + m3] = s5i + s4r;
  }
}

function bfly5(st: FftPlan, re: Float64Array, im: Float64Array, fo: number, fstride: number, m: number): void {
  const { twRe, twIm } = st;
  const yar = twRe[fstride * m];
  const yai = twIm[fstride * m];
  const ybr = twRe[fstride * 2 * m];
  const ybi = twIm[fstride * 2 * m];
  for (let u = 0; u < m; u++) {
    const i0 = fo + u;
    const i1 = i0 + m;
    const i2 = i0 + 2 * m;
    const i3 = i0 + 3 * m;
    const i4 = i0 + 4 * m;
    const t1 = u * fstride;
    const t2 = 2 * u * fstride;
    const t3 = 3 * u * fstride;
    const t4 = 4 * u * fstride;
    const s0r = re[i0];
    const s0i = im[i0];
    const s1r = re[i1] * twRe[t1] - im[i1] * twIm[t1];
    const s1i = re[i1] * twIm[t1] + im[i1] * twRe[t1];
    const s2r = re[i2] * twRe[t2] - im[i2] * twIm[t2];
    const s2i = re[i2] * twIm[t2] + im[i2] * twRe[t2];
    const s3r = re[i3] * twRe[t3] - im[i3] * twIm[t3];
    const s3i = re[i3] * twIm[t3] + im[i3] * twRe[t3];
    const s4r = re[i4] * twRe[t4] - im[i4] * twIm[t4];
    const s4i = re[i4] * twIm[t4] + im[i4] * twRe[t4];
    const s7r = s1r + s4r;
    const s7i = s1i + s4i;
    const s10r = s1r - s4r;
    const s10i = s1i - s4i;
    const s8r = s2r + s3r;
    const s8i = s2i + s3i;
    const s9r = s2r - s3r;
    const s9i = s2i - s3i;
    re[i0] = s0r + s7r + s8r;
    im[i0] = s0i + s7i + s8i;
    const s5r = s0r + s7r * yar + s8r * ybr;
    const s5i = s0i + s7i * yar + s8i * ybr;
    const s6r = s10i * yai + s9i * ybi;
    const s6i = -s10r * yai - s9r * ybi;
    re[i1] = s5r - s6r;
    im[i1] = s5i - s6i;
    re[i4] = s5r + s6r;
    im[i4] = s5i + s6i;
    const s11r = s0r + s7r * ybr + s8r * yar;
    const s11i = s0i + s7i * ybr + s8i * yar;
    const s12r = -s10i * ybi + s9i * yai;
    const s12i = s10r * ybi - s9r * yai;
    re[i2] = s11r + s12r;
    im[i2] = s11i + s12i;
    re[i3] = s11r - s12r;
    im[i3] = s11i - s12i;
  }
}

function bflyGeneric(st: FftPlan, re: Float64Array, im: Float64Array, fo: number, fstride: number, m: number, p: number): void {
  const { twRe, twIm, scratchRe, scratchIm, n } = st;
  for (let u = 0; u < m; u++) {
    for (let q1 = 0, k = u; q1 < p; q1++, k += m) {
      scratchRe[q1] = re[fo + k];
      scratchIm[q1] = im[fo + k];
    }
    for (let q1 = 0, k = u; q1 < p; q1++, k += m) {
      let twidx = 0;
      let accR = scratchRe[0];
      let accI = scratchIm[0];
      for (let q = 1; q < p; q++) {
        twidx += fstride * k;
        if (twidx >= n) twidx -= n;
        accR += scratchRe[q] * twRe[twidx] - scratchIm[q] * twIm[twidx];
        accI += scratchRe[q] * twIm[twidx] + scratchIm[q] * twRe[twidx];
      }
      re[fo + k] = accR;
      im[fo + k] = accI;
    }
  }
}
