/**
 * Performance of one practice take under a 4× CPU slowdown (Chrome DevTools throttling):
 * main-thread long tasks (> 50 ms) and dropped frames, from a performance trace plus an
 * in-page requestAnimationFrame log, split into "recording" and "result appears".
 *
 *   node tools/e2e/practice.perf.mjs           (needs the dev server on :3016 and
 *                                               .work/e2e/practice/native-am_michael.wav from practice.e2e.mjs)
 *   PERF_RATE=6 node tools/e2e/practice.perf.mjs
 */
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WAV = join(ROOT, ".work/e2e/practice/native-am_michael.wav");
const URL_ = process.env.PERF_URL ?? "http://localhost:3016/learn/u03/u03-l5?i=0";
const RATE = Number(process.env.PERF_RATE ?? 4);
if (!existsSync(WAV)) throw new Error(`run tools/e2e/practice.e2e.mjs first (${WAV})`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: !process.env.E2E_HEADFUL,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${WAV}`,
    "--disable-features=AudioServiceSandbox",
    "--autoplay-policy=no-user-gesture-required",
      // 実際のスピーカーに出すと、Mac の音声まわりの状態しだいで音声の時計が止まり、偽マイクも無音になる（2026-10-21 に発生）
      "--disable-audio-output",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(URL_, { waitUntil: "networkidle2", timeout: 60000 });
await page.waitForFunction(() => window.__practice?.phase === "ready", { timeout: 30000 });

// warm the scorer first in one untimed take, so the measured take is the steady state a learner
// gets from the second try on (the first take's model download is measured separately below)
const cdp = await page.createCDPSession();
await page.evaluate(() => {
  window.__frames = [];
  window.__marks = {};
  const loop = (t) => {
    window.__frames.push(t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  let last = window.__practice?.phase;
  setInterval(() => {
    const p = window.__practice?.phase;
    if (p !== last) {
      window.__marks[p] = window.__marks[p] ?? performance.now();
      last = p;
    }
  }, 5);
});

async function oneTake(label) {
  await page.evaluate(() => {
    window.__frames.length = 0;
    window.__marks = { start: performance.now() };
  });
  await page.click('button[aria-label="録音して話す"], button[aria-label="もう一回"]').catch(async () => {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("もう一度話す"))?.click());
  });
  await page.waitForFunction(() => window.__practice?.phase !== "result" && window.__practice?.phase !== "ready", { timeout: 30000 });
  await page.waitForFunction(() => window.__practice?.phase === "result", { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 2500)); // the score reveal (1.2 s) and the lower half
  return page.evaluate(() => ({ frames: [...window.__frames], marks: { ...window.__marks }, end: performance.now() }));
}

await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
const CATS = ["devtools.timeline", "toplevel", "disabled-by-default-devtools.timeline.frame", "blink.user_timing"];
// take 1 also starts the scorer (download + warm-up in its worker); take 2 is the steady state
await page.tracing.start({ categories: CATS });
const t1 = await oneTake("first");
const trace1 = await page.tracing.stop();
await page.tracing.start({ categories: CATS });
const t2 = await oneTake("second");
const traceBuf = await page.tracing.stop();
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
writeFileSync(join(ROOT, ".work/e2e/practice/trace-take1.json"), trace1);
writeFileSync(join(ROOT, ".work/e2e/practice/trace-take2.json"), traceBuf);

function frameStats(frames, from, to) {
  const f = frames.filter((t) => t >= from && t <= to);
  let dropped = 0;
  let worst = 0;
  for (let i = 1; i < f.length; i++) {
    const d = f[i] - f[i - 1];
    worst = Math.max(worst, d);
    if (d > 16.7 * 1.5) dropped += Math.round(d / 16.7) - 1;
  }
  const dur = (to - from) / 1000;
  return { seconds: +dur.toFixed(2), frames: f.length, fps: +(f.length / dur).toFixed(1), dropped, worstGapMs: +worst.toFixed(1) };
}

// long tasks from the trace: top-level tasks on the page's renderer main thread
function longTasks(buf) {
  const trace = JSON.parse(Buffer.from(buf).toString("utf8"));
  const events = trace.traceEvents ?? trace;
  const isTask = (e) => e.ph === "X" && /RunTask/.test(e.name) && !/ThreadPool|TaskGraph/.test(e.name);
  const names = events.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain");
  let main = null;
  let n = -1;
  for (const t of names) {
    const c = events.filter((e) => e.pid === t.pid && e.tid === t.tid && isTask(e)).length;
    if (c > n) {
      n = c;
      main = t;
    }
  }
  const tasks = events.filter((e) => main && e.pid === main.pid && e.tid === main.tid && isTask(e));
  const t0us = Math.min(...tasks.map((e) => e.ts));
  // what ran inside each long task (the biggest child events)
  const inside = (task) =>
    events
      .filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === "X" && e.ts >= task.ts && e.ts + (e.dur ?? 0) <= task.ts + task.dur && e !== task && e.dur > 5000)
      .sort((a, b) => b.dur - a.dur)
      .slice(0, 4)
      .map((e) => `${e.name}${e.args?.data?.functionName ? ":" + e.args.data.functionName : ""}${e.args?.data?.url ? "@" + String(e.args.data.url).split("/").pop() : ""} ${(e.dur / 1000).toFixed(0)}ms`);
  return {
    tasks: tasks.length,
    maxTaskMs: +(tasks.reduce((a, e) => Math.max(a, e.dur / 1000), 0)).toFixed(1),
    long: tasks.filter((e) => e.dur > 50_000).map((e) => ({ atMs: +((e.ts - t0us) / 1000).toFixed(0), ms: +(e.dur / 1000).toFixed(1), inside: inside(e) })),
  };
}
const lt1 = longTasks(trace1);
const lt2 = longTasks(traceBuf);

const m = t2.marks;
const rec = frameStats(t2.frames, m.countin ?? m.start, m.scoring ?? m.result);
const res = frameStats(t2.frames, m.result, t2.end);
const first = {
  tapToResultMs: Math.round((t1.marks.result ?? 0) - t1.marks.start),
  recording: frameStats(t1.frames, t1.marks.countin ?? t1.marks.start, t1.marks.scoring ?? t1.marks.result),
  resultAppears: frameStats(t1.frames, t1.marks.result, t1.end),
  mainThread: lt1,
};
console.log(JSON.stringify({ cpuSlowdown: RATE, firstTake: first, secondTake: { tapToResultMs: Math.round(m.result - m.start), scoringMs: Math.round(m.result - (m.scoring ?? m.result)), recording: rec, resultAppears: res, mainThread: lt2 } }, null, 2));
await browser.close();
