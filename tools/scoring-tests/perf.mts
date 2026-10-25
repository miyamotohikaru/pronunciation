/**
 * Weight and responsiveness in Chrome (puppeteer-core + installed Chrome), against a running
 * production server (next start):
 *   - first-visit payload of the given pages (cold cache), by resource type
 *   - one practice item: JSON + mp3s
 *   - /lab/score with N× CPU throttling (main thread and workers): model + runtime bytes,
 *     load time, main-thread long tasks during load and during scoring, 3 s / 8 s takes
 *   - a second visit (warm caches)
 *   node perf.mts [--base http://localhost:3018] [--cpu 4] [--providers wasm|webgpu] [--pages /,/play/demo]
 */
import puppeteer, { type Page } from "puppeteer-core";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const base = arg("--base", "http://localhost:3018");
const cpu = Number(arg("--cpu", "4"));
const providers = arg("--providers", "wasm");
const pages = arg("--pages", "/,/play/demo").split(",");
const ITEM = arg("--item", "u03-l1-07");

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", "--no-default-browser-check"],
});

type Rec = { url: string; type: string; bytes: number };
async function track(page: Page): Promise<Rec[]> {
  const recs: Rec[] = [];
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  const meta = new Map<string, { url: string; type: string }>();
  cdp.on("Network.responseReceived", (e) => meta.set(e.requestId, { url: e.response.url, type: e.type }));
  cdp.on("Network.loadingFinished", (e) => {
    const m = meta.get(e.requestId);
    if (m) recs.push({ ...m, bytes: e.encodedDataLength });
  });
  return recs;
}
const kb = (b: number) => `${(b / 1024).toFixed(0)} KB`;
const mb = (b: number) => `${(b / 1e6).toFixed(2)} MB`;
const sum = (rs: Rec[], f: (r: Rec) => boolean) => rs.filter(f).reduce((a, r) => a + r.bytes, 0);
const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// ---- 1. first visit, cold
for (const path of pages) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const recs = await track(page);
  await page.goto(base + path, { waitUntil: "networkidle0" });
  const by = (t: string) => sum(recs, (r) => r.type === t);
  console.log(
    `first visit ${path}: total ${kb(sum(recs, () => true))} = document ${kb(by("Document"))}, JS ${kb(by("Script"))}, CSS ${kb(by("Stylesheet"))}, fonts ${kb(by("Font"))}, images ${kb(by("Image"))}, other ${kb(sum(recs, (r) => !["Document", "Script", "Stylesheet", "Font", "Image"].includes(r.type)))}`,
  );
  await ctx.close();
}

// ---- 2. one practice item
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.goto(base + "/lab", { waitUntil: "domcontentloaded" });
  const recs = await track(page);
  await page.evaluate(async (id) => {
    const it = await (await fetch(`/content/items/${id}.json`)).json();
    const r = it.refs[0];
    await Promise.all([r.audio, r.slowAudio, r.slowerAudio].map((u: string) => fetch(u).then((x) => x.arrayBuffer())));
  }, ITEM);
  await new Promise((r) => setTimeout(r, 300));
  const json = sum(recs, (r) => r.url.includes("/content/items/"));
  const mp3 = recs.filter((r) => r.url.endsWith(".mp3"));
  console.log(`item ${ITEM}: JSON ${kb(json)} (gzip), mp3 ${mp3.map((r) => `${r.url.split("/").pop()} ${kb(r.bytes)}`).join(", ")}`);
  await ctx.close();
}

// ---- 3a. the lab page alone (no scorer), same throttling: its own long tasks
{
  const c0 = await browser.createBrowserContext();
  const page = await c0.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await page.goto(`${base}/lab/score?noscorer`, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 2000));
  const lt = await page.evaluate(() => window.__longTasks ?? []);
  console.log(`/lab/score without the scorer (CPU ${cpu}x): long tasks ${lt.length} [${lt.map((x) => `${x.duration} ms @${x.start}`).join(", ")}]`);
  await c0.close();
}

// ---- 3. scorer: load + score under CPU throttling, then a warm second visit
const ctx = await browser.createBrowserContext();
for (const visit of ["cold", "warm"]) {
  const page = await ctx.newPage();
  const recs = await track(page);
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  const throttledWorkers: string[] = [];
  page.on("workercreated", async (w) => {
    try {
      await w.client.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      throttledWorkers.push("ok");
    } catch (e) {
      throttledWorkers.push(String((e as Error).message));
    }
  });
  const t0 = Date.now();
  await page.goto(`${base}/lab/score?providers=${providers}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__scoreLab?.ready === true, { timeout: 600_000 });
  const info = await page.evaluate(() => ({ loadMs: window.__scoreLab!.loadMs, backend: window.__scoreLab!.backend, lt: window.__longTasks ?? [], nav: performance.now() }));
  const ltDesc = info.lt.map((x) => `${x.duration} ms @${x.start}`).join(", ");
  console.log(
    `${visit} /lab/score (${providers}, CPU ${cpu}x, workers throttled: ${throttledWorkers.join(",") || "none seen"}): ready ${info.backend} after ${Date.now() - t0} ms (worker load ${info.loadMs} ms, page clock ${Math.round(info.nav)} ms); main-thread long tasks until ready: ${info.lt.length} [${ltDesc}]`,
  );
  if (visit === "cold") {
    const before = info.lt.length;
    const bench = await page.evaluate(() => window.__scoreLab!.benchTakes([3, 8], 5));
    const lt = await page.evaluate(() => window.__longTasks ?? []);
    for (const b of bench)
      console.log(`  ${b.seconds.toFixed(1)} s take (${b.words} words): wall median ${median(b.wallMs)} ms, model ${median(b.modelMs)} ms, align ${median(b.alignMs)} ms`);
    const during = lt.slice(before);
    console.log(`  main-thread long tasks during scoring: ${during.length} (max ${Math.max(0, ...during.map((x) => x.duration))} ms) — includes decoding the test mp3s on the page`);
    // CDP cannot throttle workers: run the scorer on the (throttled) page, 1 WASM thread
    const slow = await page.evaluate(() => window.__scoreLab!.benchInPage([3, 8], 3));
    for (const b of slow)
      console.log(`  in-page, ${cpu}x CPU, 1 thread: ${b.seconds.toFixed(1)} s take: wall median ${median(b.wallMs)} ms (model ${median(b.modelMs)} ms, align ${median(b.alignMs)} ms)`);
  }
  await page.close();
}
await ctx.close();
await browser.close();
