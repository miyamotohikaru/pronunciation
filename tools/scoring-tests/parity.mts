/**
 * TS engine vs the Python reference (tools/model/export/reference_scores.py) on the test
 * clips (12 `say` clips + the Kokoro references), in three checks:
 *   mel    TS whisperLogMel vs whisper.log_mel_spectrogram (torch)
 *   logic  Python scores the TS log-probs: torchaudio forced_align + merge_tokens, GOP,
 *          sklearn -> same spans, raw scores within 1e-3 (int8 model, as shipped)
 *   e2e    fp32 model end to end (TS mel + onnxruntime-node vs torch mel + onnxruntime
 *          python) -> same spans, raw within 1e-3
 * plus the int8 end-to-end difference for information (int8 dynamic quantization is not
 * bit-stable across ONNX Runtime builds; see README).
 *   node parity.mts            (writes .work/eval/parity.json; scoring.test.ts asserts it)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { loadAssetsFs, makeScorer, readWav, ROOT, WORK, shippedTargets } from "./lib.mts";
import { cases, kokoroJsons } from "./cases.mts";
import { padForModel, whisperLogMel } from "../../src/engine/scoring/mel.ts";
import { parseVariant } from "../../src/engine/scoring/phones.ts";
import type { Scorer } from "../../src/engine/scoring/engine.ts";
import type { ScoreResult, TargetWord } from "../../src/engine/scoring/types.ts";

const TOL = 1e-3;
const FP32 = join(WORK, "onnx", "model.fp32.onnx");

type RefItem = { wav: string; melMaxAbsDiff: number; logProbMaxAbsDiff: number; phones: { phone: string; start: number; end: number; raw: number }[] };
type Row = { id: string; phones: number; sameAlign: boolean; dRaw: number };

function compare(id: string, r: ScoreResult, p: RefItem): Row {
  const mine = r.words.flatMap((w) => w.phones);
  const sameAlign = mine.length === p.phones.length && mine.every((m, k) => Math.round(m.start * 50) === p.phones[k].start && Math.round(m.end * 50) === p.phones[k].end);
  const dRaw = Math.max(...mine.map((m, k) => Math.abs(m.raw - (p.phones[k]?.raw ?? Infinity))));
  return { id, phones: mine.length, sameAlign, dRaw };
}

function python(req: object, tag: string): RefItem[] {
  const tmp = join(WORK, "eval", "parity");
  const reqPath = join(tmp, `request.${tag}.json`);
  const resPath = join(tmp, `response.${tag}.json`);
  writeFileSync(reqPath, JSON.stringify(req));
  const py = spawnSync(join(ROOT, ".venv/bin/python"), ["-I", join(ROOT, "tools/model/export/reference_scores.py"), reqPath, resPath], { encoding: "utf8" });
  if (py.status !== 0) throw new Error(`python failed: ${py.stderr}`);
  return JSON.parse(readFileSync(resPath, "utf8")) as RefItem[];
}

async function take(scorer: Scorer, file: string, words: TargetWord[], id: string, tag: string) {
  const assets = loadAssetsFs();
  const fe = assets.meta.frontEnd;
  const { audio } = readWav(file);
  const r = await scorer.score({ audio, words });
  const nMax = words.reduce((a, w) => a + Math.max(...w.variants.map((v) => parseVariant(v).length)), 0);
  const padded = padForModel(audio, fe.sampleRate, assets.meta.onnx.samplesPerFrame, nMax, fe.tailPadSeconds, fe.minSeconds);
  const mel = whisperLogMel(padded, assets.melFilters, fe.hop);
  const { lp } = await scorer.logProbs(audio, nMax);
  const tmp = join(WORK, "eval", "parity");
  const melPath = join(tmp, `${id}.mel.f32`);
  const lpPath = join(tmp, `${id}.${tag}.lp.f32`);
  writeFileSync(melPath, Buffer.from(mel.data.buffer));
  writeFileSync(lpPath, Buffer.from(lp.data.buffer));
  const phones = r.words.flatMap((w) => w.phones.map((p) => p.phone));
  return { r, item: { wav: file, nPad: nMax, phones, tsMel: melPath, tsLogProbs: lpPath } };
}

export async function runParity() {
  mkdirSync(join(WORK, "eval", "parity"), { recursive: true });
  const int8 = await makeScorer();
  const fp32 = await makeScorer({ onnx: FP32 });
  const assets = loadAssetsFs();
  const picked = cases().filter((c) => c.file.includes("/audio/") || /\/(af_heart|am_michael)\/t0[1-8]_[a-z]+\.16k\.wav$/.test(c.file));
  const runs: { id: string; i8: Awaited<ReturnType<typeof take>>; f32: Awaited<ReturnType<typeof take>> }[] = [];
  for (const c of picked) {
    const { words } = await shippedTargets(int8, c.sentence, kokoroJsons(c.sentence));
    const id = `${basename(dirname(c.file))}_${basename(c.file, ".wav")}`;
    runs.push({ id, i8: await take(int8, c.file, words, id, "int8"), f32: await take(fp32, c.file, words, id, "fp32") });
  }
  const modelDir = "public/models/whisper-phoneme";
  const int8Path = join(ROOT, modelDir, assets.meta.files.onnx[assets.meta.files.defaultOnnx]);
  const logic = python({ modelDir, onnxPath: int8Path, useTsLogProbs: true, items: runs.map((x) => x.i8.item) }, "logic");
  const e2e32 = python({ modelDir, onnxPath: FP32, useTsLogProbs: false, items: runs.map((x) => x.f32.item) }, "e2e32");
  const e2e8 = python({ modelDir, onnxPath: int8Path, useTsLogProbs: false, items: runs.map((x) => x.i8.item) }, "e2e8");
  const rows = runs.map((x, i) => ({
    id: x.id,
    phones: x.i8.r.words.reduce((a, w) => a + w.phones.length, 0),
    dMel: e2e32[i].melMaxAbsDiff,
    logic: compare(x.id, x.i8.r, logic[i]),
    e2eFp32: compare(x.id, x.f32.r, e2e32[i]),
    e2eInt8: compare(x.id, x.i8.r, e2e8[i]),
    dLogPfp32: e2e32[i].logProbMaxAbsDiff,
    dLogPint8: e2e8[i].logProbMaxAbsDiff,
  }));
  await int8.dispose();
  await fp32.dispose();
  writeFileSync(join(WORK, "eval", "parity.json"), JSON.stringify(rows, null, 1));
  return rows;
}

const fmt = (x: number) => x.toExponential(1).padStart(8);

if (process.argv[1]?.endsWith("parity.mts")) {
  const rows = await runParity();
  console.log(`${"clip".padEnd(30)} ph  mel|d|   | logic: align |dRaw|  | e2e fp32: align |dRaw|  |dLogP| | e2e int8: align |dRaw|  |dLogP|`);
  for (const r of rows)
    console.log(
      `${r.id.padEnd(30)} ${String(r.phones).padStart(2)} ${fmt(r.dMel)}  |  ${r.logic.sameAlign ? "same" : "DIFF"} ${fmt(r.logic.dRaw)}  |  ${r.e2eFp32.sameAlign ? "same" : "DIFF"} ${fmt(r.e2eFp32.dRaw)} ${fmt(r.dLogPfp32)}  |  ${r.e2eInt8.sameAlign ? "same" : "DIFF"} ${fmt(r.e2eInt8.dRaw)} ${fmt(r.dLogPint8)}`,
    );
  const bad = rows.filter((r) => !r.logic.sameAlign || r.logic.dRaw > TOL || !r.e2eFp32.sameAlign || r.e2eFp32.dRaw > TOL);
  const i8 = rows.filter((r) => r.e2eInt8.sameAlign).length;
  console.log(bad.length ? `\n${bad.length} clip(s) out of tolerance` : `\nall ${rows.length} clips: logic + fp32 end-to-end identical alignment, raw within ${TOL}`);
  console.log(`int8 end-to-end (onnxruntime-node 1.30 vs python 1.23): same alignment ${i8}/${rows.length}, max |dRaw| ${Math.max(...rows.map((r) => r.e2eInt8.dRaw)).toFixed(3)}`);
}
