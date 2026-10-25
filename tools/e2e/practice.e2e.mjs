/**
 * End-to-end test of the practice screen (/learn/<unit>/<lesson>?i=N) in real Chrome, with
 * Chrome's fake microphone playing a WAV:
 *
 *   A. the item's Kokoro am_michael reference (.work/tts/am_michael/<id>.16k.wav) against the
 *      af_heart guide  → a high score, few flagged sounds
 *   B. macOS `say -v Kyoko` reading the line in katakana → a clearly lower score, flagged sounds
 *
 *   node tools/e2e/practice.e2e.mjs            (uses the dev server on :3016, starts one if needed)
 *   E2E_HEADFUL=1 node tools/e2e/practice.e2e.mjs
 *
 * Fake files are written to .work/e2e/practice/ (git-ignored): LEAD s of room tone (so the
 * speech lands after the 3·2·1 count-in), the speech, then TRAIL s of room tone (Chrome loops it).
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { decodeWav, encodeWav } from "../../src/engine/audio/wav.ts";
import { resample } from "../../src/engine/audio/resample.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, ".work/e2e/practice");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 3016;
const BASE = `http://localhost:${PORT}`;
const LEAD = 2.0;
const TRAIL = 3.5;
const NOISE_DB = -66;

// the line is "That's right, I remember." since the content went sentences-only (2026-10-22)
const CASE = { unit: "u03", lesson: "u03-l5", index: 0, id: "u03-l5-01", kana: "ザッツ ライト、アイ リメンバー。" };

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function trimSilence(x, thr = 0.01) {
  let a = 0;
  let b = x.length;
  while (a < b && Math.abs(x[a]) < thr) a++;
  while (b > a && Math.abs(x[b - 1]) < thr) b--;
  return x.subarray(Math.max(0, a - 800), Math.min(x.length, b + 800));
}

function pad(speech16k, name) {
  const sr = 16000;
  const n = Math.round((LEAD + TRAIL) * sr) + speech16k.length;
  const out = new Float32Array(n);
  const rnd = prng(7);
  const amp = Math.pow(10, NOISE_DB / 20) * Math.sqrt(3);
  for (let i = 0; i < n; i++) out[i] = (rnd() * 2 - 1) * amp;
  const at = Math.round(LEAD * sr);
  for (let i = 0; i < speech16k.length; i++) out[at + i] += speech16k[i];
  const file = join(OUT, `${name}.wav`);
  writeFileSync(file, encodeWav(out, sr));
  return file;
}

function makeWavs() {
  mkdirSync(OUT, { recursive: true });
  const ref = decodeWav(readFileSync(join(ROOT, `.work/tts/am_michael/${CASE.id}.16k.wav`)));
  const refPcm = ref.sampleRate === 16000 ? ref.channels[0] : resample(ref.channels[0], ref.sampleRate, 16000);
  const a = pad(trimSilence(refPcm), "native-am_michael");
  const aiff = join(OUT, "kyoko.aiff");
  const wav = join(OUT, "kyoko.raw.wav");
  execFileSync("say", ["-v", "Kyoko", "-o", aiff, CASE.kana]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
  const ky = decodeWav(readFileSync(wav));
  const b = pad(trimSilence(ky.channels[0]), "katakana-kyoko");
  return { native: a, katakana: b };
}

async function up() {
  try {
    return (await fetch(`${BASE}/home`)).ok;
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

async function runCase(wav, label) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: !process.env.E2E_HEADFUL,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`,
      "--disable-features=AudioServiceSandbox",
      "--autoplay-policy=no-user-gesture-required",
      // 実際のスピーカーに出すと、Mac の音声まわりの状態しだいで音声の時計が止まり、偽マイクも無音になる（2026-10-21 に発生）
      "--disable-audio-output",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/learn/${CASE.unit}/${CASE.lesson}?i=${CASE.index}`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(() => window.__practice?.phase === "ready", { timeout: 30000 });
    const t0 = Date.now();
    await page.click('button[aria-label="録音して話す"]');
    await page.waitForFunction(() => ["result", "silent", "error"].includes(window.__practice?.phase), { timeout: 120000 });
    const out = await page.evaluate(() => window.__practice);
    const ms = Date.now() - t0;
    if (errors.length) throw new Error(`${label}: page errors: ${errors.join(" | ")}`);
    if (out.phase !== "result") throw new Error(`${label}: ended in phase ${out.phase}`);
    const r = out.result;
    console.log(
      `${label.padEnd(10)} total ${r.total.toFixed(3)}  sounds ${r.sounds.toFixed(1)}  rhythm ${r.rhythm.toFixed(1)}  intonation ${r.intonation.toFixed(1)}  ` +
        `bars P${r.counts.perfect}/G${r.counts.great}/g${r.counts.good}/M${r.counts.miss}  flagged [${r.flagged.join(", ")}]  (${ms} ms tap→result)`,
    );
    if (process.env.E2E_DEBUG) console.log(JSON.stringify(out.debug));
    return r;
  } finally {
    await browser.close();
  }
}

const server = await ensureServer();
try {
  const wavs = makeWavs();
  const native = await runCase(wavs.native, "native");
  const kata = await runCase(wavs.katakana, "katakana");
  const fails = [];
  if (!(native.sounds >= 80)) fails.push(`native sounds ${native.sounds} < 80`);
  if (!(native.total >= 75)) fails.push(`native total ${native.total} < 75`);
  if (!(kata.total < native.total - 10)) fails.push(`katakana total ${kata.total} not clearly below native ${native.total}`);
  if (!(kata.flagged.length > 0)) fails.push("katakana: no flagged sounds");
  if (fails.length) {
    console.error("FAIL\n  " + fails.join("\n  "));
    process.exitCode = 1;
  } else console.log("PASS");
} finally {
  server?.kill();
}
