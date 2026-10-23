/**
 * End-to-end test of the audio engine in real Chrome against the dev server's /lab.
 *
 *   npm run test:e2e            (starts `next dev -p 3016` itself if nothing is listening)
 *   E2E_HEADFUL=1 npm run test:e2e
 *
 * Chrome's fake capture device plays a WAV (tools/e2e/make-wavs.mjs: room tone + `say` speech
 * + room tone) in a loop. For every take we find where the capture sits in that loop by
 * cross-correlation, then check:
 *   - VAD start/stop events vs the WAV's speech region (±150 ms)
 *   - captured 16 kHz PCM correlates with the source (normalised correlation)
 *   - live pitch (onPitch stream) vs offline analyzePitch(source): median |error| < 1 semitone
 *   - crossOriginIsolated, AudioWorklet loaded same-origin under COEP, no mid-stream frame gaps,
 *     pitch latency < 50 ms (median), the 16 kHz take aligned with the capture-rate take
 * Two takes per browser (the mic is released and re-acquired between takes), plus one take
 * through the ScriptProcessor fallback, plus decoding one reference mp3 from public/audio.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { analyzePitch } from "../../src/engine/audio/pitch.ts";
import { decodeWav } from "../../src/engine/audio/wav.ts";
import { b64ToF32, comparePitch, findLoopOffset, fmt, localAlignment, quantile } from "./lib.mjs";
import { makeAll } from "./make-wavs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 3016;
const BASE = `http://localhost:${PORT}`;
const TOL_VAD = 0.15;
const SR = 16000;

async function up() {
  try {
    const r = await fetch(`${BASE}/lab`);
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await up()) return null;
  console.log("starting next dev on :3016 …");
  const child = spawn(join(ROOT, "node_modules/.bin/next"), ["dev", "--turbopack", "-p", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await up()) return child;
  }
  child.kill();
  throw new Error("dev server did not come up");
}

async function launch(wav) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: !process.env.E2E_HEADFUL,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`,
      // the sandboxed audio service can't open the file → the fake mic would be silent
      "--disable-features=AudioServiceSandbox",
      // 実際のスピーカーに出すと、Mac の音声まわりの状態しだいで音声の時計が止まり、偽マイクも無音になる（2026-10-21 に発生）
      "--disable-audio-output",
    ],
  });
}

async function takeOne(page, n) {
  await page.click("#record");
  await page.waitForFunction((k) => window.__lab.takes >= k || window.__lab.events.some((e) => e.type === "error"), { timeout: 30000 }, n);
  const err = await page.evaluate(() => window.__lab.events.filter((e) => e.type === "error").map((e) => e.detail));
  if (err.length) throw new Error(`lab error: ${err.join("; ")}`);
  const x = await page.evaluate(() => window.__lab.exportTake());
  x.pcm16k = b64ToF32(x.pcm16kB64);
  x.raw.pcm16k = b64ToF32(x.raw.pcm16kB64);
  delete x.pcm16kB64;
  delete x.raw.pcm16kB64;
  return x;
}

function analyse(take, u, source, offline, label) {
  const fail = [];
  const check = (ok, msg) => {
    if (!ok) fail.push(msg);
  };
  const raw = take.raw.pcm16k;
  const { offset, corr } = findLoopOffset(raw, source);
  // window-by-window alignment: Chrome's capture → WebAudio FIFO occasionally drops/inserts
  // 10–20 ms when the fake capture clock drifts against the output clock (invisible to the
  // worklet: its frame counter stays continuous). Map times through the local lag.
  const align = localAlignment(raw, source, offset, SR);
  const toFile = align.toLoop;
  const ev = take.stats.vadEvents;
  const start = ev.find((e) => e.type === "start");
  const end = ev.find((e) => e.type === "end");
  check(take.stopReason === "vad", `stopReason ${take.stopReason} (expected vad)`);
  check(!!start && !!end, "VAD start/end missing");
  const dStart = start ? toFile(start.t) - u.speech.start : NaN;
  const dEnd = end ? toFile(end.t) - u.speech.end : NaN;
  check(Math.abs(dStart) <= TOL_VAD, `VAD start off by ${fmt(dStart)} s`);
  check(Math.abs(dEnd) <= TOL_VAD, `VAD end off by ${fmt(dEnd)} s`);
  const rs = take.raw.speech;
  const dRefStart = rs ? toFile(rs.start) - u.speech.start : NaN;
  const dRefEnd = rs ? toFile(rs.end) - u.speech.end : NaN;
  check(Math.abs(dRefStart) <= TOL_VAD && Math.abs(dRefEnd) <= TOL_VAD, `take speech region off by ${fmt(dRefStart)} / ${fmt(dRefEnd)} s`);

  // correlation of the captured 16 kHz PCM with the source over the speech windows
  const speechWins = align.wins.filter((w) => {
    const t0 = toFile(w.a / SR);
    return t0 >= u.speech.start && t0 + (w.b - w.a) / SR <= u.speech.end;
  });
  const corrSpeech = quantile(
    speechWins.map((w) => w.corr),
    0.5,
  );
  check(speechWins.length >= 3 && corrSpeech > 0.9, `16 kHz capture vs source correlation ${fmt(corrSpeech)} ≤ 0.9 (${speechWins.length} windows)`);
  check(Math.abs(align.skippedMs) <= 60, `upstream drift corrections ${fmt(align.skippedMs, 0)} ms`);

  // the trimmed 16 kHz take is the raw stream cut at take.offset
  const o16 = Math.round(take.offset * SR);
  let maxDiff = 0;
  for (let i = 0; i < take.pcm16k.length; i++) maxDiff = Math.max(maxDiff, Math.abs(take.pcm16k[i] - raw[o16 + i]));
  check(maxDiff === 0, `trimmed pcm16k differs from raw at offset (${maxDiff})`);
  check(Math.abs(take.duration - take.pcm16k.length / SR) < 1e-9, "duration mismatch");
  check(Math.abs(take.pcmLength / take.sampleRate - take.duration) < 0.002, `capture-rate take ${take.pcmLength / take.sampleRate} s vs 16 kHz ${take.duration} s`);

  // live pitch (onPitch stream) vs offline analyzePitch(source)
  const pc = comparePitch(take.live, offline, (t) => {
    const ft = toFile(t);
    return ft >= u.speech.start - 0.05 && ft <= u.speech.end + 0.05 ? ft : null;
  });
  check(pc.medianSt < 1, `live pitch median error ${fmt(pc.medianSt)} st ≥ 1`);
  check(pc.voicedBoth > 50, `only ${pc.voicedBoth} frames voiced in both`);
  // the take's pitch frames are the live frames, re-timed
  const liveSame = take.live.length === take.raw.pitch.length && take.live.every((f, i) => f.f0 === take.raw.pitch[i].f0);
  check(liveSame, "onPitch stream differs from take.raw.pitch");
  // live == offline on the captured audio itself (same algorithm, same input)
  const offCaptured = analyzePitch(raw);
  const same = offCaptured.length === take.raw.pitch.length && offCaptured.every((f, i) => f.f0 === take.raw.pitch[i].f0 && f.rms === take.raw.pitch[i].rms);
  check(same, "analyzePitch(captured 16 kHz) ≠ live frames");

  // playback copy at the reference loudness
  const L = take.stats.loudness;
  check(!!L && Math.abs(L.outputLufs - -18) < 1 && L.truePeakDb <= -0.95, `playback loudness ${JSON.stringify(L)}`);
  const d = take.diagnostics;
  check(d.captureMode === (label.includes("SP") ? "script-processor" : "audio-worklet"), `captureMode ${d.captureMode}`);
  if (!label.includes("SP")) check(d.workletSource === "url", `worklet source ${d.workletSource} (${d.workletError})`);
  check(d.crossOriginIsolated === true, "not cross-origin isolated");
  check(d.droppedFrames === 0, `${d.droppedFrames} frames dropped mid-stream (${JSON.stringify(d.gapLog)})`);
  const lat = take.stats.pitchLatencyMs;
  if (!label.includes("SP")) check(lat && lat.median < 50, `pitch latency median ${lat && fmt(lat.median, 1)} ms`);

  return {
    label,
    fail,
    row: {
      take: label,
      offset: fmt(offset / SR, 3),
      "vadΔstart": fmt(dStart),
      "vadΔend": fmt(dEnd),
      "takeΔ": `${fmt(dRefStart, 2)}/${fmt(dRefEnd, 2)}`,
      corr: fmt(corr, 3),
      corrSpeech: fmt(corrSpeech, 4),
      skips: `${align.skips}/${fmt(align.skippedMs, 0)}ms`,
      "pitchMed(st)": fmt(pc.medianSt, 3),
      "pitchP90(st)": fmt(pc.p90St, 3),
      voiced: `${pc.voicedBoth}/${fmt(pc.voicingAgreement, 2)}`,
      "lat ms": lat ? `${fmt(lat.median, 1)}/${fmt(lat.max, 1)}` : "–",
      startup: `${fmt(d.startupMs, 0)}ms/${d.startupGapFrames}`,
      LUFS: L ? `${fmt(L.inputLufs, 1)}→${fmt(L.outputLufs, 1)}` : "–",
      load: `${fmt(take.stats.dspLoad * 100, 2)}%`,
    },
  };
}

async function main() {
  const manifest = makeAll();
  const server = await ensureServer();
  const results = [];
  try {
    const ids = Object.keys(manifest);
    for (const id of ids) {
      const u = manifest[id];
      const source = decodeWav(readFileSync(u.fake)).mono;
      const offline = analyzePitch(source);
      const browser = await launch(u.fake);
      try {
        const page = await browser.newPage();
        page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
        await page.goto(`${BASE}/lab`, { waitUntil: "networkidle0" });
        await page.waitForFunction(() => !!window.__lab, { timeout: 20000 });
        const coi = await page.evaluate(() => window.crossOriginIsolated);
        if (!coi) results.push({ label: `${id} page`, fail: ["crossOriginIsolated is false"], row: { take: `${id} page` } });
        for (let k = 1; k <= 2; k++) {
          const t = await takeOne(page, k);
          results.push(analyse(t, u, source, offline, `${id}#${k}`));
          await new Promise((r) => setTimeout(r, 400));
        }
        if (id === ids[0]) {
          // ScriptProcessor fallback
          await page.evaluate(() => {
            const box = [...document.querySelectorAll("label")].find((l) => l.textContent?.includes("ScriptProcessor"))?.querySelector("input");
            box?.click();
          });
          const t = await takeOne(page, 3);
          results.push(analyse(t, u, source, offline, `${id}#SP`));
          // Player: whole take, a segment, and A/B (reference → take) with the playhead
          const playChecks = [];
          const audioDir = join(ROOT, "public/audio");
          const mp3 = existsSync(audioDir) ? findMp3(audioDir) : null;
          if (mp3) {
            const url = "/" + mp3.slice(join(ROOT, "public").length + 1).split("\\").join("/");
            const r = await page.evaluate((x) => window.__lab.loadRef(x), url);
            const fail = r.duration > 0.2 && r.voiced > 10 ? [] : [`reference ${url}: ${JSON.stringify(r)}`];
            results.push({ label: "ref mp3", fail, row: { take: `ref ${url}`, offset: `${fmt(r.duration, 2)} s @ ${r.sampleRate}`, "vadΔstart": `decode ${fmt(r.decodeMs, 0)} ms`, voiced: `${r.voiced}/${r.frames}` } });
            playChecks.push("ab");
          }
          // "スピーカー確認": loads + plays the loud native clip (no error, audible length)
          await page.click("#speaker-check");
          await page.waitForFunction(() => window.__lab.events.some((e) => e.type === "speaker-check" || e.type === "error"), { timeout: 10000 });
          const sc = await page.evaluate(() => window.__lab.events.find((e) => e.type === "speaker-check" || e.type === "error"));
          results.push({ label: "speaker check", fail: sc.type === "error" ? [sc.detail] : [], row: { take: "speaker check", offset: `${fmt(sc.t, 2)} s`, "vadΔstart": sc.detail } });
          await new Promise((r) => setTimeout(r, 1600));
          for (const kind of ["take", "segment", ...playChecks]) {
            const r = await page.evaluate((k) => window.__lab.playTest(k), kind);
            const fail = [];
            if (!r.completed) fail.push("did not complete");
            if (Math.abs(r.wallMs - r.expectedMs) > 300) fail.push(`took ${fmt(r.wallMs, 0)} ms, expected ${fmt(r.expectedMs, 0)}`);
            if (!r.monotonic) fail.push("playhead went backwards");
            if (r.events < (r.expectedMs / 1000) * 30) fail.push(`only ${r.events} playhead events`);
            if (kind === "segment" && (r.spans[0].first < 0.5 - 1e-6 || r.spans[0].last > 1.0 + 1e-6 || r.spans[0].last < 0.95)) fail.push(`segment playhead ${fmt(r.spans[0].first)}–${fmt(r.spans[0].last)}`);
            if (kind === "ab" && r.labels.join(">") !== "native>mine") fail.push(`order ${r.labels.join(">")}`);
            results.push({ label: `play ${kind}`, fail, row: { take: `play ${kind}`, offset: `${fmt(r.wallMs, 0)}/${fmt(r.expectedMs, 0)} ms`, "vadΔstart": `${r.events} heads`, "vadΔend": r.spans.map((x) => `${fmt(x.first, 2)}–${fmt(x.last, 2)}`).join(" ") } });
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    server?.kill();
  }
  console.table(results.map((r) => r.row));
  const failed = results.filter((r) => r.fail.length);
  for (const r of failed) console.log(`FAIL ${r.label}: ${r.fail.join(" | ")}`);
  console.log(failed.length ? `\n${failed.length}/${results.length} failed` : `\nall ${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

function findMp3(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const f = findMp3(p);
      if (f) return f;
    } else if (e.name.endsWith(".mp3")) return p;
  }
  return null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
