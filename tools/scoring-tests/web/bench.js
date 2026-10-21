// Browser benchmark of src/engine/scoring through its worker (served by ../serve.mjs).
const out = document.getElementById("out");
document.getElementById("coi").textContent = String(self.crossOriginIsolated);
document.getElementById("gpu").textContent = String(!!navigator.gpu);
document.getElementById("cores").textContent = String(navigator.hardwareConcurrency);
const log = (s) => { out.textContent += s + "\n"; console.log(s); };
out.textContent = "";
const params = new URLSearchParams(location.search);
const RUNS = Number(params.get("runs") ?? 5);
const configs = (params.get("providers") ?? "wasm,webgpu").split(",");
const onnxKeys = (params.get("onnx") ?? "int8").split(",");

function decodeWav(buf) {
  const v = new DataView(buf);
  let off = 12, ch = 1, bits = 16, fmt = 1;
  while (off + 8 <= buf.byteLength) {
    const id = String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
    const size = v.getUint32(off + 4, true);
    if (id === "fmt ") { fmt = v.getUint16(off + 8, true); ch = v.getUint16(off + 10, true); bits = v.getUint16(off + 22, true); }
    if (id === "data") {
      const n = size / (bits / 8) / ch, a = new Float32Array(n);
      for (let i = 0; i < n; i++) a[i] = fmt === 3 ? v.getFloat32(off + 8 + i * 4 * ch, true) : v.getInt16(off + 8 + i * 2 * ch, true) / 32768;
      return a;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("no data");
}
const wav = async (p) => decodeWav(await (await fetch(p)).arrayBuffer());
const targets = async (id) => (await (await fetch(`/work/eval/targets/${id}.json`)).json()).words;

const SETS = { "3s": ["t01_rice", "t02_think", "t03_very"], "8s": ["t01_rice", "t02_think", "t03_very", "t04_street", "t05_want", "t06_gonna", "t07_again"] };
async function glued(ids) {
  const parts = [], words = [];
  for (const id of ids) { parts.push(await wav(`/work/tts/af_heart/${id}.16k.wav`)); words.push(...(await targets(id))); }
  const a = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { a.set(p, o); o += p.length; }
  return { audio: a, words };
}
const CLIPS = [["sam_lice", "t01_rice"], ["sam_sink", "t02_think"], ["kyo_think", "t02_think"], ["sam_sutoreeto", "t04_street"], ["sam_rice", "t01_rice"]];

function makeWorker() {
  const w = new Worker("/src/engine/scoring/worker.ts", { type: "module" });
  let next = 1; const pending = new Map(); let ready;
  const readyP = new Promise((res, rej) => (ready = { res, rej }));
  w.onmessage = (e) => {
    const m = e.data;
    if (m.type === "ready") ready.res(m);
    else if (m.type === "log") log("  · " + m.message);
    else if (m.type === "error" && m.id === undefined) ready.rej(new Error(m.message));
    else if (m.type === "result" || m.type === "error") { const p = pending.get(m.id); pending.delete(m.id); m.type === "result" ? p.res(m.result) : p.rej(new Error(m.message)); }
  };
  return {
    init: (msg) => { w.postMessage({ type: "init", ...msg }); return readyP; },
    score: (audio, words) => new Promise((res, rej) => { const id = next++; pending.set(id, { res, rej }); const a = audio.slice(); w.postMessage({ type: "score", id, audio: a, words }, [a.buffer]); }),
    close: () => w.terminate(),
  };
}
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const results = { ua: navigator.userAgent, crossOriginIsolated: self.crossOriginIsolated, webgpu: !!navigator.gpu, runs: [] };
self.__results = results;

for (const onnx of onnxKeys) for (const prov of configs) {
  const w = makeWorker();
  const t0 = performance.now();
  let ready;
  try { ready = await w.init({ modelUrl: "/models/whisper-phoneme/", ortUrl: "/ort/", providers: [prov], onnx }); }
  catch (e) { log(`${onnx}/${prov}: init failed: ${e.message}`); results.runs.push({ onnx, prov, error: e.message }); w.close(); continue; }
  log(`${onnx}/${prov}: ready on ${ready.backend} in ${ready.loadMs} ms (page ${Math.round(performance.now() - t0)} ms)`);
  const rec = { onnx, prov: ready.backend, loadMs: ready.loadMs, sets: {}, clips: {} };
  for (const [name, ids] of Object.entries(SETS)) {
    const { audio, words } = await glued(ids);
    const first = await w.score(audio, words);
    const t = { total: [], model: [], mel: [], align: [] };
    let last;
    for (let i = 0; i < RUNS; i++) { last = await w.score(audio, words); for (const k of Object.keys(t)) t[k].push(last.timing[k]); }
    rec.sets[name] = { seconds: audio.length / 16000, first: first.timing, median: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, median(v)])), sounds: last.sounds };
    log(`  ${name} (${(audio.length / 16000).toFixed(2)} s): first ${first.timing.total} ms, median total ${median(t.total)} = mel ${median(t.mel)} + model ${median(t.model)} + align ${median(t.align)}  sounds=${last.sounds}`);
  }
  for (const [clip, sent] of CLIPS) {
    const r = await w.score(await wav(`/work/audio/${clip}.wav`), await targets(sent));
    rec.clips[clip] = { sounds: r.sounds, words: r.words.map((x) => [x.text, x.score, x.phones.filter((p) => p.issue).map((p) => `${p.phone}:${p.issue}${p.heardAs ? ">" + p.heardAs : ""}`)]), insertions: r.insertions.length };
    log(`  ${clip}: sounds ${r.sounds} | ` + r.words.map((x) => `${x.text}=${x.score}`).join(" ") + (r.insertions.length ? ` ins=${r.insertions.length}` : ""));
  }
  results.runs.push(rec);
  w.close();
}
log("DONE");
results.done = true;
