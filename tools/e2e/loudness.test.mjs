/**
 * BS.1770 loudness, true peak and Take.playback normalisation (−18 LUFS, ≤ −1 dBTP).
 *   node --test tools/e2e/loudness.test.mjs        (or: npm test)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { integratedLoudness, normalizeLoudness, truePeak } from "../../src/engine/audio/loudness.ts";
import { CapturePipeline } from "../../src/engine/audio/pipeline.ts";
import { resample } from "../../src/engine/audio/resample.ts";
import { decodeWav } from "../../src/engine/audio/wav.ts";
import { makeAll } from "./make-wavs.mjs";

const manifest = makeAll();
const db = (x) => 20 * Math.log10(x);

test("997 Hz sine at −20 dBFS peak reads −23.01 LUFS (BS.1770 reference) at 48 / 44.1 kHz", () => {
  for (const sr of [48000, 44100]) {
    const x = new Float32Array(sr * 3).map((_, i) => 0.1 * Math.sin((2 * Math.PI * 997 * i) / sr));
    const l = integratedLoudness(x, sr);
    assert.ok(Math.abs(l - -23.01) < 0.05, `${sr}: ${l}`);
  }
  assert.equal(integratedLoudness(new Float32Array(48000), 48000), -Infinity);
});

test("true peak sees the inter-sample peak a sample peak misses", () => {
  const sr = 48000;
  const x = new Float32Array(sr).map((_, i) => Math.sin((2 * Math.PI * (sr / 4) * i) / sr + Math.PI / 4));
  const sample = Math.max(...x.map(Math.abs));
  assert.ok(Math.abs(db(sample) - -3.01) < 0.05);
  const tp = db(truePeak(x));
  assert.ok(tp > -0.2 && tp < 0.3, `true peak ${tp} dB`);
});

test("normalizeLoudness: quiet, normal and clicky speech → −18 LUFS, ≤ −1 dBTP", (t) => {
  const s16 = decodeWav(readFileSync(manifest.sam_rice.clean)).mono;
  const s48 = resample(s16, 16000, 48000);
  const cases = {
    "iPhone-quiet (−30 dB)": s48.map((v) => v * 0.0316),
    "as recorded": s48,
    "with clicks": s48.map((v, i) => v * 0.3 + (i % 9600 === 4800 ? 0.95 : 0)),
  };
  for (const [name, x] of Object.entries(cases)) {
    const r = normalizeLoudness(x, 48000);
    assert.ok(Math.abs(r.outputLufs - -18) < 0.5, `${name}: ${r.outputLufs} LUFS`);
    assert.ok(r.truePeakDb <= -1 + 1e-6, `${name}: TP ${r.truePeakDb}`);
    assert.ok(Math.abs(db(truePeak(r.pcm)) - r.truePeakDb) < 0.01);
    t.diagnostic(`${name}: ${r.inputLufs.toFixed(1)} → ${r.outputLufs.toFixed(2)} LUFS, gain ${r.gainDb.toFixed(1)} dB, limiter ${r.limiterDb.toFixed(2)} dB, TP ${r.truePeakDb.toFixed(2)} dBTP`);
  }
  const clicky = normalizeLoudness(cases["with clicks"], 48000);
  assert.ok(clicky.limiterDb < -3, `limiter should work on the clicks (${clicky.limiterDb} dB)`);
  // room tone alone is not boosted: absolute gate → unchanged
  const room = new Float32Array(48000).map((_, i) => Math.sin(i * 12.9898) * 0.0002);
  assert.equal(normalizeLoudness(room, 48000).gainDb, 0);
});

test("Take.playback is normalised, Take.pcm stays as recorded", () => {
  const u = manifest.sam_think;
  const x = resample(decodeWav(readFileSync(u.fake)).mono, 16000, 48000).map((v) => v * 0.03); // iPhone-quiet
  const p = new CapturePipeline({ sampleRate: 48000 });
  for (let i = 0; i < x.length && !p.stopped; i += 512) p.push(x.slice(i, i + 512));
  const take = p.finish(p.stopped ?? "manual");
  assert.ok(take.speech);
  assert.equal(take.playback.length, take.pcm.length);
  const L = take.stats.loudness;
  assert.ok(L && Math.abs(L.outputLufs - -18) < 0.5 && L.truePeakDb <= -1 + 1e-6, JSON.stringify(L));
  assert.ok(Math.abs(integratedLoudness(take.playback, 48000) - L.outputLufs) < 1e-6);
  assert.ok(integratedLoudness(take.pcm, 48000) < -40, "raw take untouched");
});
