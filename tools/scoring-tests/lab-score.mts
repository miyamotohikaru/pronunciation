/**
 * Drives /lab/score in Chrome (puppeteer-core + the installed Google Chrome) on a running
 * app server and scores several items' own reference audio through the real worker.
 *   node lab-score.mts [--base http://localhost:3016] [--providers wasm] [--headful]
 */
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const base = arg("--base", "http://localhost:3016");
const providers = arg("--providers", "");
const ITEMS: [string, string, "main" | "pair"][] = [
  ["p1", "af_heart", "main"],
  ["p2", "am_michael", "main"],
  ["u03-l1-07", "af_heart", "main"],
  ["u03-l3-02", "af_heart", "pair"],
  ["u06-l4-01", "am_michael", "main"],
  ["u10-l4-06", "af_heart", "main"],
];

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: !args.includes("--headful"),
  args: ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", "--no-default-browser-check"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[page error] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" || m.text().includes("[scoring]")) console.log(`[page] ${m.text()}`);
});
const t0 = Date.now();
await page.goto(`${base}/lab/score${providers ? `?providers=${providers}` : ""}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__scoreLab?.ready === true, { timeout: 180_000 });
const info = await page.evaluate(() => ({ backend: window.__scoreLab!.backend, loadMs: window.__scoreLab!.loadMs, coi: window.crossOriginIsolated }));
console.log(`ready: ${info.backend}, worker load ${info.loadMs} ms (page ${Date.now() - t0} ms), crossOriginIsolated ${info.coi}`);
for (const [id, voice, target] of ITEMS) {
  for (let rep = 0; rep < 2; rep++) {
    const s = await page.evaluate((a, b, c) => window.__scoreLab!.scoreReference(a, b, c), id, voice, target);
    if (rep === 0) continue; // the first call warms up shapes / shaders
    console.log(
      `${id}${target === "pair" ? "/pair" : ""} ${voice}: sounds ${s.sounds}, rhythm ${s.rhythm}, intonation ${s.intonation}, words ${s.words.map(([w, x]) => `${w}=${x}`).join(" ")}${s.flagged.length ? " FLAGS " + s.flagged.join(" ") : ""} | ${s.wallMs} ms (model ${s.timing.model}, align ${s.timing.align})`,
    );
  }
}
await browser.close();
