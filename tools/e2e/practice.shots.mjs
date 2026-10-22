/**
 * Screenshots of the real app for the blind critique rounds (390×844, deviceScaleFactor 3).
 * Run against a production server (no dev badge):
 *
 *   node tools/e2e/practice.shots.mjs http://localhost:3017 <out-dir>
 *
 * Fake microphone files (Chrome restarts the file at every capture, so one file can serve a
 * sentence take and a later one-word retry):
 *   home  — 0.3 s of room tone, then the am_michael reference of "hotel": the home card's own
 *           listen → say loop (the shot is taken while your yellow is painting over お手本's cyan)
 *   sing  — the am_michael reference of a long line at 0.65× (u10-l4-05, 3.4 s) for the mid-take shot
 *   card  — 0.25 s: the am_michael reference of "rice" (heard by the one-word retry, which starts
 *           at 0 and stops by itself), then at 2.05 s macOS `say -v Kyoko` reading
 *           "The rice is ready." in katakana (the sentence take ignores what is said during 3·2·1)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { decodeWav, encodeWav } from "../../src/engine/audio/wav.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORK = join(ROOT, ".work/e2e/practice");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.argv[2] ?? "http://localhost:3017";
const OUT = process.argv[3] ?? join(WORK, "shots");
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });

const SR = 16000;
const read16 = (file) => {
  const w = decodeWav(readFileSync(file));
  if (w.sampleRate !== SR) throw new Error(`${file}: ${w.sampleRate} Hz`);
  return w.channels[0];
};
const trim = (x, thr = 0.01) => {
  let a = 0;
  let b = x.length;
  while (a < b && Math.abs(x[a]) < thr) a++;
  while (b > a && Math.abs(x[b - 1]) < thr) b--;
  return x.subarray(Math.max(0, a - 400), Math.min(x.length, b + 800));
};
function compose(parts, total) {
  const out = new Float32Array(Math.round(total * SR));
  let s = 11;
  for (let i = 0; i < out.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    out[i] = ((s / 4294967296) * 2 - 1) * 0.0009; // room tone ≈ −66 dBFS
  }
  for (const [at, x] of parts) out.set(x.map((v, i) => v + out[Math.round(at * SR) + i]), Math.round(at * SR));
  return out;
}
function kyoko(text) {
  const aiff = join(WORK, "shots-kyoko.aiff");
  const wav = join(WORK, "shots-kyoko.wav");
  execFileSync("say", ["-v", "Kyoko", "-o", aiff, text]);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
  return trim(read16(wav));
}

const homeWav = join(WORK, "shots-home.wav");
writeFileSync(homeWav, encodeWav(compose([[0.3, trim(read16(join(ROOT, ".work/tts/am_michael/u01-l1-01.16k.wav")))]], 6), SR));
const singWav = join(WORK, "shots-sing.wav");
writeFileSync(singWav, encodeWav(compose([[1.9, trim(read16(join(ROOT, ".work/tts/am_michael/u10-l4-05.slower.16k.wav")))]], 10), SR));
const cardWav = join(WORK, "shots-card.wav");
writeFileSync(
  cardWav,
  encodeWav(compose([[0.25, trim(read16(join(ROOT, ".work/tts/am_michael/u03-l1-07.16k.wav")))], [2.05, kyoko("ザ ライス イズ レディ。")]], 9), SR),
);

async function browserWith(wav) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: !process.env.E2E_HEADFUL,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`,
      "--disable-features=AudioServiceSandbox",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-audio-output",
    ],
  });
}
async function phonePage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  return page;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. home (fresh device: nothing practised yet), mid-loop: お手本 has painted the blocks, your voice is painting over them
{
  const b = await browserWith(homeWav);
  const page = await phonePage(b);
  await page.goto(`${BASE}/home`, { waitUntil: "networkidle0" });
  await sleep(800);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("言ってみる"))?.click());
  const painting = await page
    .waitForFunction(
      () => {
        const ps = [...document.querySelectorAll(".hero-voice .hero-block")].map((e) => parseFloat(e.style.getPropertyValue("--p") || "0"));
        const sum = ps.reduce((a, b) => a + b, 0);
        return ps.length > 0 && sum > 0.5 && sum < ps.length - 0.3;
      },
      { timeout: 15000, polling: 16 },
    )
    .then(() => true)
    .catch(() => false);
  if (!painting) console.log("home: the yellow did not start (shot taken anyway)");
  await page.screenshot({ path: join(OUT, "ours-home.png") });
  await b.close();
}

// 2. mid-take on a long line (もっとゆっくり, 3.4 s)
{
  const b = await browserWith(singWav);
  const page = await phonePage(b);
  await page.goto(`${BASE}/home`, { waitUntil: "networkidle2" });
  await page.evaluate(() => localStorage.setItem("kara.v1.settings", JSON.stringify({ voice: "af_heart", speed: "slower", together: false })));
  await page.goto(`${BASE}/learn/u10/u10-l4?i=4`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => window.__practice?.phase === "ready", { timeout: 30000 });
  await sleep(500);
  await page.click('button[aria-label="録音して話す"]');
  await page.waitForFunction(() => window.__practice?.phase === "singing", { timeout: 20000 });
  await sleep(1700);
  await page.screenshot({ path: join(OUT, "ours-sing.png") });
  await page.waitForFunction(() => window.__practice?.phase === "result", { timeout: 120000 });
  await b.close();
}

// 3–5. result, the sound card, the card after saying the word again
{
  const b = await browserWith(cardWav);
  const page = await phonePage(b);
  await page.goto(`${BASE}/learn/u03/u03-l5?i=2`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => window.__practice?.phase === "ready", { timeout: 30000 });
  await sleep(400);
  await page.click('button[aria-label="録音して話す"]');
  await page.waitForFunction(() => window.__practice?.phase === "result", { timeout: 120000 });
  await sleep(2400);
  await page.screenshot({ path: join(OUT, "ours-result.png") });
  const r = await page.evaluate(() => window.__practice.result);
  console.log("take:", r.total.toFixed(3), JSON.stringify(r.words), r.flagged.join(" "));
  // the worst sound is already open on the result (inline); any other flagged word opens the sheet
  const inline = r.coach >= 0 && r.words[r.coach][0].toLowerCase() === "rice";
  console.log("coached on the result:", r.coach >= 0 ? r.words[r.coach][0] : "-", inline ? "(rice: inline)" : "(rice: sheet)");
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") || "").startsWith("rice："));
    btn?.click();
    return !!btn;
  });
  if (!opened) throw new Error("rice was not flagged — no card to open");
  await sleep(900);
  if (inline) await page.evaluate(() => document.getElementById("coach")?.scrollIntoView({ block: "start" }));
  await sleep(200);
  // drag the slider's handle most of the way to 「聞こえた音」: the filled tongue springs over and its tip lands on the ridge
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(`${sel} [role="slider"]`);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, inline ? "#coach" : '[role="dialog"]');
  if (box) {
    const y = box.y + box.h * 0.62;
    await page.mouse.move(box.x + box.w * 0.48, y);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) {
      await page.mouse.move(box.x + box.w * (0.48 + 0.04 * k), y);
      await sleep(30);
    }
    await page.mouse.up();
    await sleep(700);
    await page.evaluate((sel) => document.querySelector(`${sel}`)?.scrollTo?.({ top: 0 }), inline ? "#coach" : '[role="dialog"]');
    await sleep(150);
  }
  await page.screenshot({ path: join(OUT, "ours-card.png") });
  const before = r.words[1][1];
  await page.evaluate((sel) => [...document.querySelectorAll(`${sel} button`)].find((x) => x.textContent?.includes("だけ言う"))?.click(), inline ? "#coach" : '[role="dialog"]');
  await page.waitForFunction((s) => window.__practice?.result && window.__practice.result.words[1][1] !== s, { timeout: 60000 }, before);
  await sleep(1100); // the meter slides, the +N lands
  await page.screenshot({ path: join(OUT, "ours-card-retry.png") });
  const after = await page.evaluate(() => window.__practice.result.words[1]);
  console.log(`retry rice: ${before} → ${after[1]}`);
  await b.close();
}
console.log("shots in", OUT);
