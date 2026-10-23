/**
 * Runs web/bench.js in Chrome (puppeteer-core + the installed Google Chrome) against a
 * server with COOP/COEP (serve.mjs on :3017 by default, or the app's dev server if it
 * serves the same paths) and prints the timings the page measured.
 *   node bench-web.mts [--url http://localhost:3017/bench/?providers=wasm,webgpu] [--headful]
 */
import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORK } from "./lib.mts";

const args = process.argv.slice(2);
const url = args.includes("--url") ? args[args.indexOf("--url") + 1] : "http://localhost:3017/bench/?providers=wasm,webgpu&runs=5";
const headful = args.includes("--headful");
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: !headful,
  args: ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", "--no-default-browser-check"],
});
const page = await browser.newPage();
page.on("console", (m) => console.log(`[page] ${m.text()}`));
page.on("pageerror", (e) => console.log(`[page error] ${e.message}`));
await page.goto(url, { waitUntil: "load" });
const t0 = Date.now();
let res: { done?: boolean } | undefined;
while (Date.now() - t0 < 600_000) {
  res = await page.evaluate(() => (self as unknown as { __results?: { done?: boolean } }).__results);
  if (res?.done) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const adapter = await page.evaluate(async () => {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }).gpu;
  if (!gpu) return null;
  const a = await gpu.requestAdapter();
  return a?.info ? { vendor: a.info.vendor, architecture: a.info.architecture, description: a.info.description } : a ? {} : null;
});
writeFileSync(join(WORK, "eval", "bench-web.json"), JSON.stringify({ url, adapter, ...res }, null, 1));
console.log("adapter:", JSON.stringify(adapter));
await browser.close();
