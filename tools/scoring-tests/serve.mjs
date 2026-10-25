/**
 * Static server for the browser benchmark (Chrome): COOP/COEP like the app, TypeScript
 * served with its types stripped (node:module stripTypeScriptTypes), so the engine runs
 * in the browser exactly as written. Nothing is copied into the app.
 *   node serve.mjs [port=3017]   ->   http://localhost:3017/bench/
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const HERE = new URL("./", import.meta.url).pathname;
const port = Number(process.argv[2] ?? 3017);
const routes = [
  ["/src/", join(ROOT, "src")],
  ["/models/", join(ROOT, "public/models")],
  ["/ort/", join(HERE, "node_modules/onnxruntime-web/dist")],
  ["/bench/", join(HERE, "web")],
  ["/work/", join(ROOT, ".work")],
];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".ts": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".onnx": "application/octet-stream", ".wav": "audio/wav" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let path = decodeURIComponent(url.pathname);
  if (path === "/bench/") path = "/bench/index.html";
  if (process.env.LOG_ORT && path.startsWith("/ort/")) console.log("GET", path);
  const route = routes.find(([p]) => path.startsWith(p));
  const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cache-Control": "no-store" };
  if (!route) return res.writeHead(404, headers).end("not found");
  // bench-only extras: the fp32 / weight-only models live in .work/onnx, not in public/
  const extra = path.match(/^\/models\/whisper-phoneme\/model\.(fp32|int8w)\.onnx$/);
  if (path === "/models/whisper-phoneme/meta.json") {
    const meta = JSON.parse(await readFile(join(ROOT, "public/models/whisper-phoneme/meta.json"), "utf8"));
    meta.files.onnx.fp32 = "model.fp32.onnx";
    meta.files.onnx.int8w = "model.int8w.onnx";
    meta.files.sessionConfig = { ...meta.files.sessionConfig, int8w: { "session.disable_quant_qdq": "1" } };
    return res.writeHead(200, { ...headers, "Content-Type": "application/json" }).end(JSON.stringify(meta));
  }
  const file = extra ? join(ROOT, ".work/onnx", `model.${extra[1]}.onnx`) : normalize(join(route[1], path.slice(route[0].length)));
  if (!extra && !file.startsWith(route[1])) return res.writeHead(403, headers).end();
  try {
    await stat(file);
    let body = await readFile(file);
    if (file.endsWith(".ts")) body = Buffer.from(stripTypeScriptTypes(body.toString("utf8"), { mode: "strip" }));
    res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404, headers).end("not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}/bench/`));
