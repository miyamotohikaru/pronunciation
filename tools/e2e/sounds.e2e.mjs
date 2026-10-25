/**
 * 発音一覧 (/sounds) end to end, with a fake microphone (Chrome restarts the file at every capture):
 *   1. r, the word "right" said by the am_michael reference      → ○ (the sound is heard as /r/)
 *   2. r, the word "right" chosen but "light" said (its pair)    → ✕ and the sound it was heard as
 * The scorer is loaded only after the mic is touched (the page never fetches it on open).
 *
 *   node tools/e2e/sounds.e2e.mjs [base=http://localhost:3016] [shots-dir]
 *
 * With a shots dir it also saves (390×844 @3x): ours-sounds-iy (a vowel opened), ours-sounds-ok
 * (○), ours-sounds-r-miss (✕, your tongue over お手本's), ours-sounds-pc (1280 wide).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { decodeWav, encodeWav } from "../../src/engine/audio/wav.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORK = join(ROOT, ".work/e2e/sounds");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.argv[2] ?? "http://localhost:3016";
const OUT = process.argv[3] ?? null;
mkdirSync(WORK, { recursive: true });
if (OUT) mkdirSync(OUT, { recursive: true });

const SR = 16000;
const read16 = (file) => {
  const w = decodeWav(readFileSync(file));
  if (w.sampleRate !== SR) throw new Error(`${file}: ${w.sampleRate} Hz`);
  return w.channels[0];
};
function compose(parts, total) {
  const out = new Float32Array(Math.round(total * SR));
  let s = 7;
  for (let i = 0; i < out.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    out[i] = ((s / 4294967296) * 2 - 1) * 0.0009; // room tone ≈ −66 dBFS
  }
  for (const [at, x] of parts) out.set(x.map((v, i) => v + out[Math.round(at * SR) + i]), Math.round(at * SR));
  return out;
}
const wordWav = (word) => {
  const f = join(WORK, `${word}.wav`);
  writeFileSync(f, encodeWav(compose([[0.3, read16(join(ROOT, `.work/tts/am_michael/w-${word}.16k.wav`))]], 4), SR));
  return f;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function browserWith(wav) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: !process.env.E2E_HEADFUL,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--disable-features=AudioServiceSandbox", "--autoplay-policy=no-user-gesture-required", "--disable-audio-output"],
  });
}
async function phone(b, width = 390, height = 844, dpr = 3) {
  const page = await b.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: dpr, isMobile: width < 900, hasTouch: width < 900 });
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  return page;
}
const state = (page) => page.evaluate(() => window.__sounds);
const clickLabel = (page, re) =>
  page.evaluate((src) => {
    const r = new RegExp(src);
    const el = [...document.querySelectorAll("button")].find((x) => r.test(x.getAttribute("aria-label") ?? "") || r.test(x.textContent ?? ""));
    el?.click();
    return !!el;
  }, re.source);

/** open r, choose "right", make the scorer ready (touch the mic), then say it */
async function sayOnR(page) {
  await page.goto(`${BASE}/sounds?s=R`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => window.__sounds?.sel === "R", { timeout: 30000 });
  const loaded0 = await page.evaluate(() => performance.getEntriesByType("resource").some((e) => /\.onnx/.test(e.name)));
  if (loaded0) throw new Error("the scorer was fetched on open");
  if (!(await clickLabel(page, /^right を聞く$/))) throw new Error("no 'right' chip");
  await page.waitForFunction(() => window.__sounds?.word === "right" && window.__sounds?.item === "ready", { timeout: 20000 });
  await clickLabel(page, /と言ってみる|準備中/); // the first touch only asks for the scorer
  await page.waitForFunction(() => window.__sounds?.scorer.ready, { timeout: 180000 });
  await sleep(300);
  const t0 = Date.now();
  if (!(await clickLabel(page, /right と言ってみる/))) throw new Error("no mic");
  await page.waitForFunction(() => window.__sounds?.check.state === "done", { timeout: 30000 });
  const s = await state(page);
  return { ...s.check, ms: Date.now() - t0 };
}

let failed = false;

// 1. right → ○
{
  const b = await browserWith(wordWav("right"));
  const page = await phone(b);
  const r = await sayOnR(page);
  console.log(`right  → ${r.ok ? "○" : "✕"} ${r.text}${r.heard ? ` (heard ${r.heard})` : ""}  (${r.ms} ms tap→verdict, incl. the word)`);
  if (!r.ok) failed = true;
  if (OUT) {
    await sleep(600);
    await page.screenshot({ path: join(OUT, "ours-sounds-ok.png") });
  }
  await b.close();
}

// 2. light where right is asked → ✕, heard as another sound
{
  const b = await browserWith(wordWav("light"));
  const page = await phone(b);
  const r = await sayOnR(page);
  console.log(`light  → ${r.ok ? "○" : "✕"} ${r.text}${r.heard ? ` (heard ${r.heard})` : ""}  (${r.ms} ms)`);
  if (r.ok || !r.heard) failed = true;
  if (OUT) {
    await sleep(600);
    await page.screenshot({ path: join(OUT, "ours-sounds-r-miss.png") });
  }
  await b.close();
}

// 3. the shots of a vowel opened, and the wide layout
if (OUT) {
  const b = await browserWith(wordWav("right"));
  const page = await phone(b);
  await page.goto(`${BASE}/sounds?s=IY`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => window.__sounds?.sel === "IY", { timeout: 30000 });
  await sleep(900);
  await page.screenshot({ path: join(OUT, "ours-sounds-iy.png") });
  const wide = await phone(b, 1280, 800, 2);
  await wide.goto(`${BASE}/sounds?s=R`, { waitUntil: "networkidle2" });
  await wide.waitForFunction(() => window.__sounds?.sel === "R", { timeout: 30000 });
  await sleep(900);
  await wide.screenshot({ path: join(OUT, "ours-sounds-pc.png") });
  await b.close();
}

console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
