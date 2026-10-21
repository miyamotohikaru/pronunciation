/**
 * CapturePipeline + VAD in plain Node: the browser capture path without the browser.
 *   node --test tools/e2e/pipeline.test.mjs        (or: npm test)
 * The fake-capture WAVs (room tone + `say` + room tone) are upsampled to typical hardware
 * rates and pushed in random AudioWorklet-sized chunks.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CapturePipeline } from "../../src/engine/audio/pipeline.ts";
import { VadDetector } from "../../src/engine/audio/vad.ts";
import { analyzePitch } from "../../src/engine/audio/pitch.ts";
import { resample } from "../../src/engine/audio/resample.ts";
import { decodeWav, encodeWav } from "../../src/engine/audio/wav.ts";
import { comparePitch, normalizedCorr, quantile } from "./lib.mjs";
import { makeAll } from "./make-wavs.mjs";

const SR = 16000;
const manifest = makeAll();

function rnd(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** push `x` (capture rate) through a pipeline in random 128·k chunks until it auto-stops */
function run(x, rate, opts = {}, seed = 1) {
  const r = rnd(seed);
  const events = [];
  const live = [];
  let levels = 0;
  const p = new CapturePipeline(
    { sampleRate: rate, keepRaw: true, ...opts },
    {
      onSpeechStart: (e) => events.push({ type: "start", t: e.t }),
      onSpeechEnd: (e) => events.push({ type: e.rejected ? "rejected" : "end", t: e.t }),
      onPitch: (f) => live.push(f),
      onLevel: () => levels++,
    },
  );
  for (let i = 0; i < x.length && !p.stopped; ) {
    const n = 128 * (1 + Math.floor(r() * 4));
    p.push(x.slice(i, i + n));
    i += n;
  }
  const take = p.finish(p.stopped ?? "manual");
  return { take, events, live, levels };
}

function noise(n, db, seed) {
  const r = rnd(seed);
  const a = Math.pow(10, db / 20) * Math.sqrt(3);
  return new Float32Array(n).map(() => (r() * 2 - 1) * a);
}

test("capture path at 48 / 44.1 kHz: VAD ±150 ms, 16 kHz ≈ source, live pitch == offline", (t) => {
  for (const [id, u] of Object.entries(manifest)) {
    const src = decodeWav(readFileSync(u.fake)).mono;
    const offline = analyzePitch(src);
    for (const rate of [48000, 44100]) {
      const { take, events, live, levels } = run(resample(src, SR, rate), rate);
      const start = events.find((e) => e.type === "start");
      const end = events.find((e) => e.type === "end");
      assert.equal(take.stopReason, "vad", `${id}@${rate}`);
      assert.ok(Math.abs(start.t - u.speech.start) <= 0.15, `${id}@${rate} start ${start.t} vs ${u.speech.start}`);
      assert.ok(Math.abs(end.t - u.speech.end) <= 0.15, `${id}@${rate} end ${end.t} vs ${u.speech.end}`);
      // auto-stop = end + 800 ms
      assert.ok(Math.abs(take.stats.rawDuration - end.t - 0.8) < 0.03, `${id}@${rate} stopped at ${take.stats.rawDuration}`);
      // round trip through the capture rate keeps the 16 kHz signal
      const raw = take.raw.pcm16k;
      const c = normalizedCorr(raw, src, 0, 0, Math.min(raw.length, src.length));
      assert.ok(c > 0.999, `${id}@${rate} corr ${c}`);
      // live frames are exactly analyzePitch of the captured 16 kHz stream …
      assert.deepEqual(live, analyzePitch(raw), `${id}@${rate} live ≠ analyzePitch(raw)`);
      // … and match the source's offline track
      const cmp = comparePitch(live, offline);
      assert.ok(cmp.medianSt < 0.05 && cmp.voicingAgreement > 0.97, `${id}@${rate} ${JSON.stringify(cmp)}`);
      // trimming: [speech.start − 250 ms, speech.end + 200 ms] on the 10 ms grid, both rates aligned
      const rs = take.raw.speech;
      assert.ok(Math.abs(take.offset - Math.max(0, Math.floor((rs.start - 0.25) * 100 + 1e-9) / 100)) < 1e-9, `${id} offset ${take.offset}`);
      assert.ok(Math.abs(take.offset + take.duration - (Math.ceil((rs.end + 0.2) * 100 - 1e-9) / 100)) < 1e-6, `${id} end ${take.offset + take.duration}`);
      assert.deepEqual(take.pcm16k, raw.slice(Math.round(take.offset * SR), Math.round(take.offset * SR) + take.pcm16k.length));
      assert.ok(Math.abs(take.pcm.length / rate - take.duration) < 1 / SR + 1 / rate, `${id} rate mismatch`);
      assert.ok(Math.abs(take.speech.start - (rs.start - take.offset)) < 1e-9);
      for (const f of take.pitch) assert.ok(Math.abs(f.t * 100 - Math.round(f.t * 100)) < 1e-6, "take.pitch off the 10 ms grid");
      assert.ok(Math.abs(levels / take.stats.rawDuration - 60) < 1, `${levels} level events`);
      if (rate === 48000) t.diagnostic(`${id}: start ${(start.t - u.speech.start).toFixed(3)} s, end ${(end.t - u.speech.end).toFixed(3)} s, pitch median ${cmp.medianSt.toFixed(4)} st, dsp ${(take.stats.dspLoad * 100).toFixed(2)} %`);
    }
  }
});

test("silence only: no utterance, stops at the 12 s cap", () => {
  const { take, events } = run(noise(48000 * 13, -62, 5), 48000);
  assert.equal(events.length, 0);
  assert.equal(take.stopReason, "max");
  assert.equal(take.speech, null);
  assert.ok(Math.abs(take.stats.rawDuration - 12) < 0.02, `${take.stats.rawDuration}`);
  assert.ok(Math.abs(take.duration - 12) < 0.02, "no speech → untrimmed");
});

test("start-up zeros then AGC-loud room tone: no false onset; speech after it is found", () => {
  const u = manifest.sam_rice;
  const s = decodeWav(readFileSync(u.clean)).mono;
  const rate = 48000;
  const zeros = new Float32Array(rate * 0.3 + 237); // not frame-aligned: one half-silent frame
  const room = noise(rate * 1.5, -48, 11);
  const speech48 = resample(s, SR, rate);
  const tail = noise(rate * 2, -48, 12);
  const x = new Float32Array(zeros.length + room.length + speech48.length + tail.length);
  x.set(zeros);
  x.set(room, zeros.length);
  for (let i = 0; i < speech48.length; i++) x[zeros.length + room.length + i] = speech48[i] + tail[i % tail.length] * 0.999;
  x.set(tail, zeros.length + room.length + speech48.length);
  const { take, events } = run(x, rate);
  const t0 = (zeros.length + room.length) / rate;
  assert.equal(events[0].type, "start");
  assert.ok(Math.abs(events[0].t - t0) < 0.15, `onset ${events[0].t} vs ${t0}`);
  assert.equal(take.stopReason, "vad");
});

test("VadDetector: a quiet half-silent first frame must not pin the floor under the room tone", () => {
  // the exact level sequence of a failing Chrome run: start-up zeros, one partial frame, room tone
  const v = new VadDetector();
  const ev = [];
  const r = rnd(77);
  const levels = [...Array(15).fill(-100), -65, ...Array.from({ length: 200 }, () => -51.5 + (r() - 0.5))];
  for (const l of levels) ev.push(...v.process(l));
  assert.deepEqual(ev, []);
  assert.ok(Math.abs(v.floorDb - -51) < 1.5, `floor ${v.floorDb}`);
});

test("a 30 ms click is ignored, an 80 ms bump is rejected, the utterance after them is kept", () => {
  const rate = 48000;
  const u = manifest.sam_think;
  const s = resample(decodeWav(readFileSync(u.clean)).mono, SR, rate);
  const x = noise(rate * 6, -60, 21);
  for (let i = 0; i < rate * 0.03; i++) x[rate * 0.6 + i] += (i % 40 < 20 ? 0.5 : -0.5) * Math.exp(-i / 400);
  const bump = noise(rate * 0.08, -12, 22);
  for (let i = 0; i < bump.length; i++) x[rate * 1.2 + i] += bump[i];
  const at = rate * 2.5;
  for (let i = 0; i < s.length && at + i < x.length; i++) x[at + i] += s[i];
  const { take, events } = run(x, rate);
  assert.deepEqual(
    events.map((e) => e.type),
    ["start", "rejected", "start", "end"],
  );
  assert.ok(Math.abs(events[2].t - 2.5) < 0.15, `onset ${events[2].t}`);
  assert.ok(take.speech && take.offset > 2, `take starts at ${take.offset}`);
});

test("a 500 ms pause inside the utterance does not end it", () => {
  const rate = 44100;
  const a = decodeWav(readFileSync(manifest.sam_think.clean)).mono;
  const b = decodeWav(readFileSync(manifest.sam_rice.clean)).mono;
  const clean = new Float32Array(SR + a.length + SR / 2 + b.length + SR * 2);
  clean.set(a, SR);
  clean.set(b, SR + a.length + SR / 2);
  const x = resample(clean, SR, rate);
  const room = noise(x.length, -64, 31);
  for (let i = 0; i < x.length; i++) x[i] += room[i];
  const { events, take } = run(x, rate);
  assert.deepEqual(
    events.map((e) => e.type),
    ["start", "end"],
  );
  const endTruth = (SR + a.length + SR / 2 + b.length) / SR;
  assert.ok(Math.abs(events[1].t - endTruth) < 0.15, `end ${events[1].t} vs ${endTruth}`);
  assert.equal(take.stopReason, "vad");
});

test("quiet speaker (−20 dB) in a noisy room (−52 dBFS, ~19 dB SNR)", () => {
  const rate = 48000;
  const s = resample(decodeWav(readFileSync(manifest.fred_fish.clean)).mono, SR, rate);
  const x = noise(rate * 8, -52, 41);
  const at = rate;
  for (let i = 0; i < s.length; i++) x[at + i] += s[i] * 0.1;
  const { events, take } = run(x, rate);
  assert.equal(events[0]?.type, "start", JSON.stringify(events));
  assert.ok(Math.abs(events[0].t - 1) < 0.15, `onset ${events[0].t}`);
  assert.equal(take.stopReason, "vad");
  const end = events.find((e) => e.type === "end");
  assert.ok(Math.abs(end.t - (1 + s.length / rate)) < 0.3, `end ${end.t}`);
});

test("WAV encode/decode round trip", () => {
  const x = new Float32Array(1000).map((_, i) => Math.sin(i / 7) * 0.8);
  const d16 = decodeWav(encodeWav(x, 22050));
  assert.equal(d16.sampleRate, 22050);
  assert.ok(Math.max(...d16.mono.map((v, i) => Math.abs(v - x[i]))) <= 2 / 32768);
  const df = decodeWav(encodeWav(x, 48000, { float: true }));
  assert.deepEqual(df.mono, x);
  assert.ok(quantile([1, 2, 3], 0.5) === 2);
});
