/** Helpers shared by the tools/e2e tests (Node only). */

/** in-place iterative radix-2 complex FFT (re/im Float64Array of power-of-two length) */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
}

/**
 * Where does `x` sit inside the looping signal `loop`?  Returns the lag φ (samples, 0 ≤ φ < L)
 * maximising Σ x[n]·loop[(n + φ) mod L] and the normalised correlation there.
 */
export function findLoopOffset(x, loop) {
  const L = loop.length;
  const need = L + x.length;
  let N = 1;
  while (N < need) N <<= 1;
  const tiled = new Float64Array(N);
  for (let i = 0; i < Math.min(N, L + x.length); i++) tiled[i] = loop[i % L];
  const ar = new Float64Array(N);
  const ai = new Float64Array(N);
  ar.set(tiled);
  const br = new Float64Array(N);
  const bi = new Float64Array(N);
  for (let i = 0; i < x.length; i++) br[i] = x[i];
  fft(ar, ai);
  fft(br, bi);
  // corr[φ] = Σ x[n] tiled[n + φ]  →  IFFT(A · conj(B))
  for (let k = 0; k < N; k++) {
    const r = ar[k] * br[k] + ai[k] * bi[k];
    const i = ai[k] * br[k] - ar[k] * bi[k];
    ar[k] = r;
    ai[k] = i;
  }
  fft(ar, ai, true);
  let best = 0;
  for (let p = 1; p < L; p++) if (ar[p] > ar[best]) best = p;
  return { offset: best, corr: normalizedCorr(x, loop, best) };
}

/** Pearson-free normalised correlation of x[n] with loop[(n + φ) mod L] (optionally on [a, b)) */
export function normalizedCorr(x, loop, offset, a = 0, b = x.length) {
  const L = loop.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let n = a; n < b; n++) {
    const y = loop[(n + offset) % L];
    sxy += x[n] * y;
    sxx += x[n] * x[n];
    syy += y * y;
  }
  return sxy / Math.sqrt(sxx * syy || 1);
}

/**
 * Local alignment, window by window: for each `win`-sample window of x, the lag (relative to
 * `offset`, searched ±search around the previous window's lag) that best matches the loop.
 * A change of lag between windows = samples dropped (+) or inserted (−) upstream of the page —
 * e.g. Chrome's MediaStreamAudioSourceNode FIFO correcting drift between the (fake) capture
 * clock and the output clock. Returns the windows and a time mapping x-time → loop-time.
 */
export function localAlignment(x, loop, offset, sr, { win = 4000, search = 800 } = {}) {
  const L = loop.length;
  const wins = [];
  let prev = 0;
  for (let a = 0; a < x.length; a += win) {
    const b = Math.min(x.length, a + win);
    if (b - a < win / 2) break;
    let best = -2;
    let bl = prev;
    for (let l = prev - search; l <= prev + search; l++) {
      const c = normalizedCorr(x, loop, (((offset + l) % L) + L) % L, a, b);
      if (c > best) {
        best = c;
        bl = l;
      }
    }
    wins.push({ a, b, lag: bl, corr: best });
    prev = bl;
  }
  const lagAt = (n) => {
    const w = wins[Math.min(wins.length - 1, Math.max(0, Math.floor(n / win)))];
    return w ? w.lag : 0;
  };
  const dur = L / sr;
  const toLoop = (t) => {
    const n = t * sr;
    return ((((n + offset + lagAt(n)) / sr) % dur) + dur) % dur;
  };
  let skips = 0;
  let skipped = 0;
  for (let i = 1; i < wins.length; i++) {
    if (wins[i].lag !== wins[i - 1].lag) {
      skips++;
      skipped += wins[i].lag - wins[i - 1].lag;
    }
  }
  return { wins, toLoop, skips, skippedMs: (skipped / sr) * 1000 };
}

export function b64ToF32(b64) {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

export function quantile(xs, q) {
  if (!xs.length) return NaN;
  const a = [...xs].sort((p, r) => p - r);
  const pos = Math.min(a.length - 1, Math.max(0, q * (a.length - 1)));
  const i = Math.floor(pos);
  return i + 1 < a.length ? a[i] + (a[i + 1] - a[i]) * (pos - i) : a[i];
}

/** f0 of an offline pitch track at time t (log-linear interpolation; null if either side unvoiced) */
export function f0At(frames, t, hop = 0.01) {
  const k = t / hop;
  const i = Math.floor(k);
  const a = frames[i];
  const b = frames[i + 1];
  if (!a || !b || a.f0 === null || b.f0 === null) {
    const near = frames[Math.round(k)];
    return near && near.f0 !== null && Math.abs(near.t - t) < hop * 0.25 ? near.f0 : null;
  }
  const f = k - i;
  return Math.exp(Math.log(a.f0) * (1 - f) + Math.log(b.f0) * f);
}

/**
 * Compare a pitch track against a reference track. `map(t)` converts a frame time of `track`
 * to reference time (or null to skip). Returns |semitone error| stats on frames voiced in both,
 * plus voicing agreement.
 */
export function comparePitch(track, ref, map = (t) => t) {
  const errs = [];
  let both = 0;
  let onlyA = 0;
  let onlyB = 0;
  let neither = 0;
  for (const f of track) {
    const t = map(f.t);
    if (t === null || t < 0) continue;
    const r = f0At(ref, t);
    if (f.f0 !== null && r !== null) {
      both++;
      errs.push(Math.abs(12 * Math.log2(f.f0 / r)));
    } else if (f.f0 !== null) onlyA++;
    else if (r !== null) onlyB++;
    else neither++;
  }
  const n = both + onlyA + onlyB + neither;
  return {
    voicedBoth: both,
    onlyTrack: onlyA,
    onlyRef: onlyB,
    voicingAgreement: n ? (both + neither) / n : NaN,
    medianSt: quantile(errs, 0.5),
    p90St: quantile(errs, 0.9),
    grossOver1St: errs.length ? errs.filter((e) => e > 1).length / errs.length : NaN,
  };
}

export const fmt = (x, d = 3) => (typeof x === "number" ? x.toFixed(d) : String(x));
