/**
 * analyzePitch / PitchTracker and the resampler, in plain Node (no browser).
 *   node --test tools/e2e/pitch.test.mjs        (or: npm test)
 * Speech WAVs come from macOS `say` (tools/e2e/make-wavs.mjs → .work/e2e/speech/).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { analyzePitch, PitchTracker } from "../../src/engine/audio/pitch.ts";
import { resample, StreamResampler } from "../../src/engine/audio/resample.ts";
import { rms } from "../../src/engine/audio/dsp.ts";
import { decodeWav } from "../../src/engine/audio/wav.ts";
import { comparePitch, quantile } from "./lib.mjs";
import { makeAll } from "./make-wavs.mjs";

const SR = 16000;
const st = (a, b) => 12 * Math.log2(a / b);
const manifest = makeAll();
const speech = Object.fromEntries(Object.entries(manifest).map(([id, m]) => [id, decodeWav(readFileSync(m.clean)).mono]));

function rnd(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function sweep(seconds, f0a, f0b, harmonics = 1, amp = 0.3) {
  const n = SR * seconds;
  const x = new Float32Array(n);
  const fAt = (t) => f0a * Math.pow(f0b / f0a, t / seconds);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += (2 * Math.PI * fAt(i / SR)) / SR;
    let s = 0;
    for (let h = 1; h <= harmonics; h++) s += Math.sin(h * ph) / h;
    x[i] = amp * s;
  }
  return { x, fAt };
}

function sweepErrors(frames, fAt, seconds) {
  const inner = frames.filter((f) => f.t > 0.05 && f.t < seconds - 0.05);
  const voiced = inner.filter((f) => f.f0 !== null);
  const errs = voiced.map((f) => Math.abs(st(f.f0, fAt(f.t))));
  return { voicedRatio: voiced.length / inner.length, median: quantile(errs, 0.5), p95: quantile(errs, 0.95), max: Math.max(...errs) };
}

test("pure tones 65–500 Hz: every frame voiced, error < 0.01 semitone", () => {
  for (const f of [65, 73, 82, 98, 110, 147, 196, 262, 349, 440, 500]) {
    const x = new Float32Array(SR);
    for (let i = 0; i < SR; i++) x[i] = 0.25 * Math.sin((2 * Math.PI * f * i) / SR);
    const fr = analyzePitch(x).slice(5, -5);
    assert.ok(fr.every((q) => q.f0 !== null), `${f} Hz: unvoiced frames`);
    const worst = Math.max(...fr.map((q) => Math.abs(st(q.f0, f))));
    assert.ok(worst < 0.01, `${f} Hz: worst error ${worst} st`);
  }
});

test("sine sweep 70→480 Hz: median error < 0.1 st", (t) => {
  const { x, fAt } = sweep(3, 70, 480);
  const e = sweepErrors(analyzePitch(x), fAt, 3);
  t.diagnostic(`sine sweep: voiced ${e.voicedRatio.toFixed(3)}, median ${e.median.toFixed(3)} st, p95 ${e.p95.toFixed(3)} st`);
  assert.ok(e.voicedRatio > 0.97, `voiced ${e.voicedRatio}`);
  // the YIN window's effective centre trails the frame centre by a few ms → ~0.06 st on an
  // 11 st/s sweep; real intonation moves far slower
  assert.ok(e.median < 0.1 && e.p95 < 0.15, JSON.stringify(e));
});

test("harmonic sweep (5 partials) and missing fundamental", (t) => {
  const { x, fAt } = sweep(3, 70, 480, 5, 0.2);
  const e = sweepErrors(analyzePitch(x), fAt, 3);
  t.diagnostic(`harmonic sweep: voiced ${e.voicedRatio.toFixed(3)}, median ${e.median.toFixed(3)} st, max ${e.max.toFixed(3)} st`);
  assert.ok(e.voicedRatio > 0.97 && e.median < 0.1 && e.max < 0.5, JSON.stringify(e));
  // partials 2–5 of 150 Hz only (telephone-like): the period is still 1/150 s
  const y = new Float32Array(SR);
  for (let i = 0; i < SR; i++) for (let h = 2; h <= 5; h++) y[i] += (0.1 * Math.sin((2 * Math.PI * 150 * h * i) / SR + h)) / h;
  const fr = analyzePitch(y).slice(5, -5);
  const errs = fr.filter((q) => q.f0 !== null).map((q) => Math.abs(st(q.f0, 150)));
  assert.ok(errs.length > fr.length * 0.95 && quantile(errs, 0.5) < 0.05, `missing fundamental: ${errs.length}/${fr.length}, median ${quantile(errs, 0.5)}`);
});

test("noisy sweep (SNR 10 dB): median error < 0.25 st", (t) => {
  const { x, fAt } = sweep(3, 70, 480);
  const r = rnd(7);
  const noise = (0.3 / Math.SQRT2 / Math.sqrt(10)) * Math.sqrt(3);
  for (let i = 0; i < x.length; i++) x[i] += (r() * 2 - 1) * noise;
  const e = sweepErrors(analyzePitch(x), fAt, 3);
  t.diagnostic(`noisy sweep: voiced ${e.voicedRatio.toFixed(3)}, median ${e.median.toFixed(3)} st, p95 ${e.p95.toFixed(3)} st`);
  assert.ok(e.voicedRatio > 0.9 && e.median < 0.25, JSON.stringify(e));
});

test("iPhone-quiet input (−30 dB, −75 dBFS mic noise) voices like the original", (t) => {
  const r = rnd(5);
  for (const [id, x] of Object.entries(speech)) {
    const base = analyzePitch(x).filter((f) => f.f0 !== null).length;
    const q = x.map((v) => v * 0.0316 + (r() * 2 - 1) * 0.00031);
    const quiet = analyzePitch(q).filter((f) => f.f0 !== null).length;
    t.diagnostic(`${id}: voiced frames ${base} → ${quiet} at −30 dB`);
    assert.ok(quiet >= base * 0.9, `${id}: ${quiet} vs ${base}`);
  }
});

test("a 4 s sustained tone stays voiced (the noise floor learns from unvoiced frames only)", () => {
  const x = new Float32Array(SR * 4);
  for (let i = 0; i < x.length; i++) x[i] = 0.05 * Math.sin((2 * Math.PI * 180 * i) / SR) + 0.02 * Math.sin((2 * Math.PI * 360 * i) / SR);
  const fr = analyzePitch(x).slice(3, -3);
  assert.ok(fr.every((f) => f.f0 !== null), `${fr.filter((f) => f.f0 === null).length} unvoiced frames`);
});

test("silence and white noise are unvoiced", () => {
  assert.equal(analyzePitch(new Float32Array(SR)).filter((f) => f.f0 !== null).length, 0);
  const r = rnd(1);
  const x = new Float32Array(2 * SR).map(() => (r() * 2 - 1) * 0.2);
  const fr = analyzePitch(x);
  assert.ok(fr.filter((f) => f.f0 !== null).length <= fr.length * 0.02, "noise voiced");
});

test("frame grid: 100 frames/s centred on k·10 ms", () => {
  for (const n of [1, 159, 160, 161, 16000, 16001]) {
    const fr = analyzePitch(new Float32Array(n));
    assert.equal(fr.length, Math.floor((n - 1) / 160) + 1, `n=${n}`);
    fr.forEach((f, k) => assert.equal(f.t, (k * 160) / SR));
  }
  assert.equal(analyzePitch(new Float32Array(0)).length, 0);
  const tr = new PitchTracker();
  assert.ok(tr.latency > 0.02 && tr.latency < 0.035, `latency ${tr.latency}`);
});

test("streaming in random chunks is bit-identical to analyzePitch", () => {
  const r = rnd(3);
  for (const x of Object.values(speech)) {
    const ref = analyzePitch(x);
    const tr = new PitchTracker();
    const out = [];
    for (let i = 0; i < x.length; ) {
      const n = 1 + Math.floor(r() * 700);
      out.push(...tr.push(x.subarray(i, i + n)));
      i += n;
    }
    out.push(...tr.flush());
    assert.deepEqual(out, ref);
  }
});

test("say voices: plausible f0, voicing and no octave jumps", (t) => {
  const expect = { sam: [150, 260], fred: [80, 150] };
  for (const [id, x] of Object.entries(speech)) {
    const fr = analyzePitch(x);
    const voiced = fr.filter((f) => f.f0 !== null);
    const ratio = voiced.length / fr.length;
    const med = quantile(voiced.map((f) => f.f0), 0.5);
    const [lo, hi] = expect[id.split("_")[0]];
    assert.ok(ratio > 0.4 && ratio < 0.95, `${id}: voiced ${ratio}`);
    assert.ok(med > lo && med < hi, `${id}: median f0 ${med}`);
    let jumps = 0;
    for (let k = 1; k < fr.length; k++) if (fr[k].f0 && fr[k - 1].f0 && Math.abs(st(fr[k].f0, fr[k - 1].f0)) > 7) jumps++;
    assert.ok(jumps <= voiced.length * 0.01, `${id}: ${jumps} octave-ish jumps`);
    t.diagnostic(`${id}: ${(x.length / SR).toFixed(2)} s, voiced ${ratio.toFixed(2)}, median f0 ${med.toFixed(0)} Hz, jumps ${jumps}`);
  }
});

test("speech played 1.2× faster: f0 ×1.2 at t/1.2 (median within 0.25 st)", (t) => {
  const r = 1.2;
  for (const [id, x] of Object.entries(speech)) {
    const base = analyzePitch(x);
    const fast = resample(x, SR * r, SR); // same samples, read r× faster
    const shifted = analyzePitch(fast).map((f) => ({ t: f.t, f0: f.f0 === null ? null : f.f0 / r, rms: f.rms }));
    const c = comparePitch(shifted, base, (t) => t * r);
    assert.ok(c.medianSt < 0.25 && c.voicedBoth > 50, `${id}: ${JSON.stringify(c)}`);
    t.diagnostic(`${id} ×1.2: median ${c.medianSt.toFixed(3)} st, p90 ${c.p90St.toFixed(3)} st, voicing agreement ${c.voicingAgreement.toFixed(2)}`);
  }
});

test("resampler: flat passband, ≥ 80 dB alias rejection, zero phase, streaming == batch", () => {
  for (const inRate of [48000, 44100, 96000, 22050]) {
    const gainDb = (f) => {
      const x = new Float32Array(inRate);
      for (let i = 0; i < inRate; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * f * i) / inRate);
      const y = resample(x, inRate, SR);
      assert.equal(y.length, Math.ceil((x.length * SR) / inRate));
      return 20 * Math.log10(rms(y, 2000, y.length - 2000) / (0.5 / Math.SQRT2) + 1e-12);
    };
    for (const f of [100, 1000, 4000, 6500]) assert.ok(Math.abs(gainDb(f)) < 0.05, `${inRate}: ${f} Hz passband ${gainDb(f)} dB`);
    for (const f of [8500, 10000]) if (f < inRate / 2) assert.ok(gainDb(f) < -80, `${inRate}: ${f} Hz leaks ${gainDb(f)} dB`);
  }
  const imp = new Float32Array(48000);
  imp[4800] = 1;
  const yi = resample(imp, 48000, SR);
  let best = 0;
  for (let k = 0; k < yi.length; k++) if (Math.abs(yi[k]) > Math.abs(yi[best])) best = k;
  assert.equal(best, 1600, "impulse at 0.1 s must stay at 0.1 s");
  const r = rnd(9);
  const x = new Float32Array(44100 * 2).map(() => r() * 2 - 1);
  const ref = resample(x, 44100, SR);
  const s = new StreamResampler(44100, SR);
  const parts = [];
  for (let i = 0; i < x.length; ) {
    const n = 1 + Math.floor(r() * 900);
    parts.push(...s.process(x.subarray(i, i + n)));
    i += n;
  }
  parts.push(...s.flush());
  assert.deepEqual(Float32Array.from(parts), ref);
});
