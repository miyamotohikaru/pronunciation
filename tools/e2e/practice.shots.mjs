/**
 * Screenshots of the real app for the blind critique rounds (390×844, deviceScaleFactor 3).
 * Run against a production server (no dev badge):
 *
 *   node tools/e2e/practice.shots.mjs http://localhost:3017 <out-dir>
 *
 * Fake microphone files (Chrome restarts the file at every capture, so one file can serve a
 * sentence take and a later one-word retry):
 *   home  — 0.3 s of room tone, then the am_michael reference of the home line: the home card
 *           as it opens (the light running over the syllables: ours-home.png) and while you speak
 *           (タップして話す, your voice painting the syllables: ours-home-speaking.png)
 *   sing  — the am_michael reference of a long line at 0.65× (u10-l4-05, 3.4 s) for the mid-take shot
 *   card  — 0.25 s: "rice" cut from the am_michael reference of u03-l1-07 (heard by the one-word
 *           retry, which starts at 0 and stops by itself), then at 2.05 s macOS `say -v Kyoko`
 *           reading "The rice is ready, so let's eat." in katakana (the sentence take ignores
 *           what is said during 3·2·1)
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
// result: Kyoko reading "The rice is ready, so let's eat." in katakana — several mistakes to move between
const resultWav = join(WORK, "shots-result.wav");
writeFileSync(resultWav, encodeWav(compose([[2.05, kyoko("ザ ライス イズ レディ、ソウ レッツ イート。")]], 10), SR));
// the card: an r / l mistake for sure — the am_michael reference of "Turn right at the light." (u03-l3-01)
// with its "right" replaced by its own "light" ("Turn light at the light."); and, at 0.25 s, the real
// "right" alone, which is what the one-word retry hears (Chrome restarts the file at each capture)
const cardWav = join(WORK, "shots-card.wav");
{
  const x = read16(join(ROOT, ".work/tts/am_michael/u03-l3-01.16k.wav"));
  const cut = (a, b) => x.slice(Math.round(a * SR), Math.round(b * SR));
  const right = cut(0.37, 0.65);
  const swapped = new Float32Array([...cut(0, 0.39), ...cut(0.8, 1.1), ...cut(0.627, x.length / SR)]);
  writeFileSync(cardWav, encodeWav(compose([[0.25, right], [2.05, swapped]], 10), SR));
}

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

// 1. home (fresh device: nothing practised yet): as the card opens, the light runs over the syllables
//    once (ours-home); then タップして話す, and your voice paints them (ours-home-speaking)
{
  const b = await browserWith(homeWav);
  const page = await phonePage(b);
  await page.goto(`${BASE}/home`, { waitUntil: "networkidle0" });
  const swept = await page
    .waitForFunction(
      () => {
        const os = [...document.querySelectorAll(".hero-guide .hero-block")].map((e) => parseFloat(e.style.getPropertyValue("--o") || "0"));
        const lit = os.filter((o) => o > 0.9).length;
        return os.length > 2 && lit >= 1 && os[os.length - 1] < 0.5 && os.slice(0, 2).some((o) => o < 0.9);
      },
      { timeout: 15000, polling: 16 },
    )
    .then(() => true)
    .catch(() => false);
  if (!swept) console.log("home: the light did not run (shot taken anyway)");
  await page.screenshot({ path: join(OUT, "ours-home.png") });
  await sleep(2600);
  await page.evaluate(() => [...document.querySelectorAll('section[aria-label="次に言う文"] button')].find((x) => x.textContent?.includes("タップして話す"))?.click());
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
  if (!painting) console.log("home: your voice did not paint (shot taken anyway)");
  await page.screenshot({ path: join(OUT, "ours-home-speaking.png") });
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

// 3. the result of a katakana take
{
  const b = await browserWith(resultWav);
  const page = await phonePage(b);
  await page.goto(`${BASE}/learn/u03/u03-l5?i=2`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => window.__practice?.phase === "ready", { timeout: 30000 });
  await sleep(400);
  await page.click('button[aria-label="録音して話す"]');
  await page.waitForFunction(() => window.__practice?.phase === "result", { timeout: 120000 });
  await sleep(2400);
  await page.screenshot({ path: join(OUT, "ours-result.png") });
  const r = await page.evaluate(() => window.__practice.result);
  console.log("result take:", r.total.toFixed(3), JSON.stringify(r.words), r.flagged.join(" "));
  await b.close();
}

// 4–5. the sound card on an r / l mistake, and after saying the word again
{
  const b = await browserWith(cardWav);
  const page = await phonePage(b);
  await page.goto(`${BASE}/learn/u03/u03-l3?i=0`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => window.__practice?.phase === "ready", { timeout: 30000 });
  await sleep(400);
  await page.click('button[aria-label="録音して話す"]');
  await page.waitForFunction(() => window.__practice?.phase === "result", { timeout: 120000 });
  await sleep(2400);
  const r = await page.evaluate(() => window.__practice.result);
  console.log("card take:", r.total.toFixed(3), JSON.stringify(r.words), r.flagged.join(" "));
  // the card on the result opens on the mistake that matters most: make sure it is the r / l one
  console.log("coached first:", r.coach >= 0 ? r.words[r.coach][0] : "-");
  const wi = ["right", "light"].map((t) => r.words.findIndex((w) => w[0].toLowerCase() === t)).find((k) => k >= 0 && r.flagged.some((f) => f.startsWith(`${r.words[k][0]}.`) && /\.(R|L):/.test(f)));
  if (wi === undefined) throw new Error("neither right nor light was heard wrong: no r / l card");
  if (r.coach !== wi) {
    const picked = await page.evaluate((t) => {
      [...document.querySelectorAll("#coach button")].find((x) => x.textContent?.startsWith("ほかに"))?.click();
      const tab = [...document.querySelectorAll('#coach [role="tab"]')].find((x) => x.textContent?.trim().toLowerCase().endsWith(t));
      tab?.click();
      return !!tab;
    }, r.words[wi][0].toLowerCase());
    if (!picked) throw new Error("the r / l word is not on the card");
  }
  await sleep(900); // the pair recording (right / light) arrives
  // the card as it opens: your tongue (the sound it was heard as), お手本's dashed, ① the way, ② the lips
  await page.evaluate(() => document.getElementById("coach")?.scrollIntoView({ block: "start" }));
  await sleep(150);
  await page.screenshot({ path: join(OUT, "ours-card.png") });
  const before = r.words[wi][1];
  // the bar's main action now: 「rice だけ言う」
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("だけ言う"))?.click());
  // done when the word has been heard and scored (the score may or may not move)
  await sleep(1200);
  await page.waitForFunction(
    () => {
      const busy = [...document.querySelectorAll("button")].some((x) => /聞いています|くらべています/.test(x.textContent ?? ""));
      return !busy && window.__practice?.rec?.()?.state === "idle";
    },
    { timeout: 60000 },
  );
  await sleep(900);
  await page.evaluate(() => document.getElementById("coach")?.scrollIntoView({ block: "start" }));
  await sleep(150);
  await page.screenshot({ path: join(OUT, "ours-card-retry.png") });
  const after = await page.evaluate((k) => window.__practice.result.words[k], wi);
  console.log(`retry ${after[0]}: ${before} → ${after[1]}`);
  await b.close();
}
console.log("shots in", OUT);
