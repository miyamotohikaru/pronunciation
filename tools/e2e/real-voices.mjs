/**
 * analyzePitch on REAL human recordings vs Praat (tools/e2e/real-voices-ref.py makes the data).
 *
 *   npm run test:voices                         (fails if recall / octave errors regress)
 *   node tools/e2e/real-voices.mjs '{"maxAperiodicity":0.35}'   (try PitchOptions)
 *
 * Every file is resampled to 16 kHz with the engine's resampler and analysed as recorded
 * ("orig") and as an iPhone without AGC would deliver it ("quiet": −25 dB, plus white noise
 * at −75 dBFS for the mic self-noise). Metrics per frame, against Praat's autocorrelation
 * tracker (65–500 Hz, default costs):
 *   recall      share of Praat-voiced frames we call voiced
 *   falseAlarm  share of Praat-unvoiced frames we call voiced
 *   gross       |error| > 2 semitones among frames voiced in both;  octave = within 1.5 st of ±12
 *   median      median |error| (semitones) among the non-gross frames
 *   run         mean length of our voiced runs (frames) — short runs are the "only dots" look
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePitch } from "../../src/engine/audio/pitch.ts";
import { resample } from "../../src/engine/audio/resample.ts";
import { decodeWav } from "../../src/engine/audio/wav.ts";
import { quantile } from "./lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX = join(ROOT, ".work/e2e/real/index.json");
const opts = process.argv[2] ? JSON.parse(process.argv[2]) : {};

// regression gates (overall, both conditions)
const MIN_RECALL = 0.88;
const MAX_OCTAVE = 0.025;
const MAX_FALSE_ALARM = 0.08;

function rnd(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function evaluate(frames, praat) {
  const { t: pt, f0: pf } = praat;
  const t0 = pt[0];
  const dt = pt.length > 1 ? pt[1] - pt[0] : 0.01;
  const m = { refV: 0, refU: 0, hit: 0, fa: 0, both: 0, gross: 0, octave: 0, errs: [], runs: [] };
  let run = 0;
  for (const f of frames) {
    if (f.f0 !== null) run++;
    else if (run) {
      m.runs.push(run);
      run = 0;
    }
    const i = Math.round((f.t - t0) / dt);
    if (i < 0 || i >= pf.length || Math.abs(pt[i] - f.t) > 0.006) continue;
    const ref = pf[i];
    if (ref > 0) {
      m.refV++;
      if (f.f0 !== null) {
        m.hit++;
        m.both++;
        const e = 12 * Math.log2(f.f0 / ref);
        const k = Math.round(e / 12);
        if (Math.abs(e) > 2) {
          m.gross++;
          if (k !== 0 && Math.abs(e - 12 * k) < 1.5) m.octave++;
        } else m.errs.push(Math.abs(e));
      }
    } else {
      m.refU++;
      if (f.f0 !== null) m.fa++;
    }
  }
  if (run) m.runs.push(run);
  return m;
}

function merge(list) {
  const out = { refV: 0, refU: 0, hit: 0, fa: 0, both: 0, gross: 0, octave: 0, errs: [], runs: [] };
  for (const m of list) {
    for (const k of ["refV", "refU", "hit", "fa", "both", "gross", "octave"]) out[k] += m[k];
    out.errs.push(...m.errs);
    out.runs.push(...m.runs);
  }
  return {
    files: list.length,
    recall: out.hit / out.refV,
    falseAlarm: out.fa / out.refU,
    gross: out.gross / out.both,
    octave: out.octave / out.both,
    median: quantile(out.errs, 0.5),
    run: out.runs.reduce((a, b) => a + b, 0) / Math.max(1, out.runs.length),
  };
}

function praatRun(praat) {
  const runs = [];
  let r = 0;
  for (const v of praat.f0) {
    if (v > 0) r++;
    else if (r) {
      runs.push(r);
      r = 0;
    }
  }
  if (r) runs.push(r);
  return runs.reduce((a, b) => a + b, 0) / Math.max(1, runs.length);
}

function main() {
  if (!existsSync(INDEX)) {
    console.log("no real recordings: run `.venv/bin/python -I tools/e2e/real-voices-ref.py` first — skipped");
    return;
  }
  const index = JSON.parse(readFileSync(INDEX, "utf8"));
  const rows = [];
  const all = { orig: [], quiet: [] };
  const byDs = new Map();
  const rand = rnd(1234);
  const t0 = performance.now();
  let audioSec = 0;
  for (const e of index) {
    const { mono, sampleRate } = decodeWav(readFileSync(join(ROOT, e.wav)));
    const x16 = resample(mono, sampleRate, 16000);
    audioSec += x16.length / 16000;
    const quiet = new Float32Array(x16.length);
    const g = Math.pow(10, -25 / 20);
    const n = Math.pow(10, -75 / 20) * Math.sqrt(3);
    for (let i = 0; i < x16.length; i++) quiet[i] = x16[i] * g + (rand() * 2 - 1) * n;
    for (const [cond, x] of [
      ["orig", x16],
      ["quiet", quiet],
    ]) {
      const m = evaluate(analyzePitch(x, opts), e.praat);
      all[cond].push(m);
      const key = `${e.dataset}|${cond}`;
      if (!byDs.has(key)) byDs.set(key, { list: [], praatRuns: [] });
      byDs.get(key).list.push(m);
      byDs.get(key).praatRuns.push(praatRun(e.praat));
    }
  }
  const ms = performance.now() - t0;
  for (const [key, v] of byDs) {
    const [ds, cond] = key.split("|");
    const r = merge(v.list);
    rows.push({ dataset: ds, cond, files: r.files, recall: r.recall.toFixed(3), falseAlarm: r.falseAlarm.toFixed(3), gross: r.gross.toFixed(3), octave: r.octave.toFixed(3), "median st": r.median.toFixed(3), run: r.run.toFixed(1), "praat run": (v.praatRuns.reduce((a, b) => a + b, 0) / v.praatRuns.length).toFixed(1) });
  }
  const fail = [];
  for (const cond of ["orig", "quiet"]) {
    const r = merge(all[cond]);
    rows.push({ dataset: "ALL", cond, files: r.files, recall: r.recall.toFixed(3), falseAlarm: r.falseAlarm.toFixed(3), gross: r.gross.toFixed(3), octave: r.octave.toFixed(3), "median st": r.median.toFixed(3), run: r.run.toFixed(1), "praat run": "" });
    if (r.recall < MIN_RECALL) fail.push(`${cond}: recall ${r.recall.toFixed(3)} < ${MIN_RECALL}`);
    if (r.octave > MAX_OCTAVE) fail.push(`${cond}: octave errors ${r.octave.toFixed(3)} > ${MAX_OCTAVE}`);
    if (r.falseAlarm > MAX_FALSE_ALARM) fail.push(`${cond}: false alarms ${r.falseAlarm.toFixed(3)} > ${MAX_FALSE_ALARM}`);
  }
  console.table(rows);
  console.log(`${index.length} files, ${(audioSec / 60).toFixed(1)} min × 2 conditions analysed in ${(ms / 1000).toFixed(1)} s (incl. resampling)${Object.keys(opts).length ? `, options ${JSON.stringify(opts)}` : ""}`);
  if (fail.length) {
    console.log(`FAIL ${fail.join(" | ")}`);
    process.exit(1);
  }
  console.log("passed");
}

main();
