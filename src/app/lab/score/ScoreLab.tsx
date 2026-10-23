"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import catalogJson from "@/data/catalog.json";
import type { Catalog, ItemData, ItemWord, RefVoice } from "@/data/schema";
import { createScoringClient, DEFAULT_MODEL_URL, type ScoringClient, type ScoringProgress } from "@/engine/scoring/client.ts";
import { createScorer } from "@/engine/scoring/engine.ts";
import { createOrtBackend, type OrtModuleLike } from "@/engine/scoring/backend-ort.ts";
import { loadAssets, loadModelBytes } from "@/engine/scoring/assets.ts";
import type { ScoreResult } from "@/engine/scoring/types.ts";
import { MicRecorder, analyzePitch, type PitchFrame } from "@/engine/audio";
import { compareProsody, type ProsodyResult, type Take as ProsodyTake } from "@/engine/prosody";

/**
 * /lab/score — the browser scorer inside the app: pick an item, record (or score the item's
 * own reference audio), see the ScoreResult and the prosody comparison with the reference.
 * Automation hook: window.__scoreLab (tools/scoring-tests/lab-score.mts).
 */

const catalog = catalogJson as unknown as Catalog;
const WORKLET_URL = "/worklets/mic-capture.js";

type Target = "main" | "pair";
type Run = { source: "mic" | "reference"; result: ScoreResult; prosody: ProsodyResult | null; ms: number };
type Summary = {
  backend: string | null;
  sounds: number;
  words: [string, number][];
  flagged: string[];
  rhythm: number | null;
  intonation: number | null;
  timing: ScoreResult["timing"];
  wallMs: number;
};

type Bench = { seconds: number; words: number; runs: number; wallMs: number[]; modelMs: number[]; alignMs: number[] };

declare global {
  interface Window {
    __scoreLab?: {
      ready: boolean;
      backend: string | null;
      loadMs: number | null;
      scoreReference: (id: string, voice: string, target?: Target) => Promise<Summary>;
      /** glue reference takes into ~N-second takes and score each `runs` times */
      benchTakes: (seconds: number[], runs: number) => Promise<Bench[]>;
      /**
       * The same, with the scorer on THIS page's main thread and 1 WASM thread: CDP CPU
       * throttling only reaches pages, so this is how a slow phone core is measured.
       */
      benchInPage: (seconds: number[], runs: number) => Promise<Bench[]>;
    };
    /** main-thread long tasks since the page loaded (PerformanceObserver "longtask") */
    __longTasks?: { start: number; duration: number }[];
  }
}

if (typeof window !== "undefined" && !window.__longTasks && "PerformanceObserver" in window) {
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks!.push({ start: Math.round(e.startTime), duration: Math.round(e.duration) });
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // no longtask support
  }
}

/** ~seconds of af_heart reference takes glued together, with their words */
async function gluedTake(seconds: number): Promise<{ pcm: Float32Array; words: ItemWord[] }> {
  const ids = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
  const parts: Float32Array[] = [];
  const words: ItemWord[] = [];
  let total = 0;
  for (const id of ids) {
    if (total >= seconds * 16000) break;
    const it = await fetchItem(id);
    const pcm = await decode16k(it.refs[0].audio);
    const room = seconds * 16000 - total;
    if (pcm.length > room * 1.4 && parts.length) break;
    parts.push(pcm);
    words.push(...it.words);
    total += pcm.length;
  }
  const pcm = new Float32Array(total);
  let off = 0;
  for (const x of parts) {
    pcm.set(x, off);
    off += x.length;
  }
  return { pcm, words };
}

const unpackPitch = (p: RefVoice["pitch"]): PitchFrame[] => p.map(([t, f0, rms]) => ({ t, f0: f0 > 0 ? f0 : null, rms: rms / 1000 }));

function options(): { id: string; label: string }[] {
  const out = catalog.placement.map((p) => ({ id: p.id, label: `${p.id} · ${p.text}` }));
  for (const u of catalog.units)
    for (const l of u.lessons) for (const it of l.items) out.push({ id: it.id, label: `${it.id} · ${it.text}${it.pair ? ` / ${it.pair}` : ""}` });
  return out;
}

async function fetchItem(id: string): Promise<ItemData> {
  const r = await fetch(`/content/items/${id}.json`);
  if (!r.ok) throw new Error(`item ${id}: ${r.status}`);
  return (await r.json()) as ItemData;
}

/** decode an mp3 straight to 16 kHz mono */
async function decode16k(url: string): Promise<Float32Array> {
  const buf = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const audio = await ctx.decodeAudioData(buf);
  return audio.getChannelData(0).slice();
}

function pick(item: ItemData, target: Target): { words: ItemWord[]; scoring: ItemData["scoring"]; refs: RefVoice[] } {
  if (target === "pair" && item.pairItem) return { words: item.pairItem.words, scoring: item.pairItem.scoring, refs: item.pairItem.refs };
  return { words: item.words, scoring: item.scoring, refs: item.refs };
}

export default function ScoreLab() {
  const clientRef = useRef<ScoringClient | null>(null);
  const recRef = useRef<MicRecorder | null>(null);
  const [progress, setProgress] = useState("not loaded");
  const [backend, setBackend] = useState<string | null>(null);
  const [itemId, setItemId] = useState("p1");
  const [voice, setVoice] = useState("af_heart");
  const [target, setTarget] = useState<Target>("main");
  const [item, setItem] = useState<ItemData | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(options, []);
  const [isolated, setIsolated] = useState<string>("");
  useEffect(() => setIsolated(String(window.crossOriginIsolated)), []);

  // load the scorer once
  useEffect(() => {
    // ?providers=wasm (or webgpu,wasm) to force a backend; ?noscorer to measure the page alone
    const search = new URLSearchParams(window.location.search);
    if (search.has("noscorer")) return;
    const forced = search.get("providers");
    const client = createScoringClient(forced ? { providers: forced.split(",") } : {});
    clientRef.current = client;
    const hook = {
      ready: false,
      backend: null as string | null,
      loadMs: null as number | null,
      scoreReference: async (id: string, v: string, t: Target = "main") => {
        const it = await fetchItem(id);
        return summarize(await scoreWith(client, it, v, t, "reference"), client.backend);
      },
      benchInPage: async (seconds: number[], runs: number) => {
        const ort = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "/models/ort/ort.wasm.bundle.min.mjs" as string)) as OrtModuleLike;
        if (ort.env?.wasm) {
          ort.env.wasm.wasmPaths = "/models/ort/";
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.proxy = false;
        }
        const assets = await loadAssets(DEFAULT_MODEL_URL);
        const key = assets.meta.files.defaultOnnx;
        const bytes = await loadModelBytes(DEFAULT_MODEL_URL, assets.meta, key);
        const extra = assets.meta.files.sessionConfig?.[key];
        const backend = await createOrtBackend(ort, bytes, {
          inputName: assets.meta.onnx.input,
          outputName: assets.meta.onnx.output,
          nMels: assets.meta.frontEnd.nMels,
          executionProviders: ["wasm"],
          sessionOptions: extra ? { extra } : undefined,
        });
        const scorer = createScorer(assets, backend);
        const out: Bench[] = [];
        for (const sec of seconds) {
          const { pcm, words } = await gluedTake(sec);
          const b: Bench = { seconds: pcm.length / 16000, words: words.length, runs, wallMs: [], modelMs: [], alignMs: [] };
          for (let i = 0; i < runs; i++) {
            const t0 = performance.now();
            const r = await scorer.score({ audio: pcm.slice(), words });
            b.wallMs.push(Math.round(performance.now() - t0));
            b.modelMs.push(r.timing.model);
            b.alignMs.push(r.timing.align);
          }
          out.push(b);
        }
        await scorer.dispose();
        return out;
      },
      benchTakes: async (seconds: number[], runs: number) => {
        const out: Bench[] = [];
        for (const sec of seconds) {
          const { pcm, words } = await gluedTake(sec);
          const b: Bench = { seconds: pcm.length / 16000, words: words.length, runs, wallMs: [], modelMs: [], alignMs: [] };
          await client.score(pcm, words); // shapes / shaders warm
          for (let i = 0; i < runs; i++) {
            const t0 = performance.now();
            const r = await client.score(pcm, words);
            b.wallMs.push(Math.round(performance.now() - t0));
            b.modelMs.push(r.timing.model);
            b.alignMs.push(r.timing.align);
          }
          out.push(b);
        }
        return out;
      },
    };
    window.__scoreLab = hook;
    const fmt = (p: ScoringProgress) =>
      p.phase === "model" && p.total ? `model ${(((p.loaded ?? 0) / p.total) * 100).toFixed(0)}%${p.cached ? " (cache)" : ""}` : p.phase;
    client
      .load((p) => setProgress(fmt(p)))
      .then((r) => {
        setBackend(r.backend);
        setProgress(`ready in ${r.loadMs} ms`);
        hook.ready = true;
        hook.backend = r.backend;
        hook.loadMs = r.loadMs;
      })
      .catch((e: unknown) => setError(String((e as Error).message ?? e)));
    return () => client.dispose();
  }, []);

  useEffect(() => {
    let alive = true;
    setItem(null);
    setRun(null);
    fetchItem(itemId)
      .then((it) => alive && setItem(it))
      .catch((e: unknown) => alive && setError(String((e as Error).message ?? e)));
    return () => {
      alive = false;
    };
  }, [itemId]);

  const scoreRef = useCallback(async () => {
    if (!item || !clientRef.current) return;
    setBusy(true);
    setError(null);
    try {
      setRun(await scoreWith(clientRef.current, item, voice, target, "reference"));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }, [item, voice, target]);

  // record() must be called synchronously in the click handler (iOS gesture rule)
  const record = () => {
    if (!item || !clientRef.current) return;
    if (recording) {
      recRef.current?.stop();
      return;
    }
    const rec = recRef.current ?? new MicRecorder({ workletUrl: WORKLET_URL }, { onStateChange: (s) => setRecording(s === "recording" || s === "starting") });
    recRef.current = rec;
    setError(null);
    rec
      .record()
      .then(async (take) => {
        setBusy(true);
        const speech: [number, number] = take.speech ? [take.speech.start, take.speech.end] : [0, take.duration];
        setRun(await scoreAudio(clientRef.current!, item, voice, target, take.pcm16k, take.pitch, speech, "mic"));
      })
      .catch((e: unknown) => setError(String((e as Error).message ?? e)))
      .finally(() => setBusy(false));
  };

  const sel = item ? pick(item, target) : null;
  const ref = sel?.refs.find((r) => r.voice === voice) ?? sel?.refs[0];

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "16px", fontSize: 14, lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>score lab</h1>
      <p style={{ margin: "0 0 12px", color: "var(--pt-soft)" }}>
        scorer: <b data-testid="progress">{progress}</b>
        {backend ? ` · backend ${backend}` : ""}
        {isolated ? ` · crossOriginIsolated ${isolated}` : ""}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} style={{ maxWidth: "100%" }} aria-label="item">
          {items.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="reference voice">
          <option value="af_heart">af_heart</option>
          <option value="am_michael">am_michael</option>
        </select>
        {item?.pairItem ? (
          <select value={target} onChange={(e) => setTarget(e.target.value as Target)} aria-label="target">
            <option value="main">{item.text}</option>
            <option value="pair">{item.pairItem.text}</option>
          </select>
        ) : null}
        <button onClick={record} disabled={!item || !backend || busy}>
          {recording ? "stop" : "record"}
        </button>
        <button onClick={scoreRef} disabled={!item || !backend || busy}>
          score the reference audio
        </button>
        {ref ? <audio src={ref.audio} controls preload="none" style={{ height: 32 }} /> : null}
      </div>
      {item ? (
        <p style={{ margin: "0 0 12px" }}>
          <b>{target === "pair" && item.pairItem ? item.pairItem.text : item.text}</b> — {item.ja}
          {item.note ? ` (${item.note})` : ""} · variants:{" "}
          {sel?.words.map((w) => `${w.text} [${w.variants.join(" | ")}]`).join("  ")}
          {ref ? ` · reference self-score ${ref.selfScore.sounds} (min word ${ref.selfScore.minWord})` : ""}
        </p>
      ) : null}
      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}
      {run ? <RunView run={run} /> : null}
    </main>
  );
}

async function scoreWith(client: ScoringClient, item: ItemData, voice: string, target: Target, source: "reference"): Promise<Run> {
  const sel = pick(item, target);
  const ref = sel.refs.find((r) => r.voice === voice) ?? sel.refs[0];
  const pcm = await decode16k(ref.audio);
  return scoreAudio(client, item, voice, target, pcm, analyzePitch(pcm), ref.speech, source);
}

async function scoreAudio(
  client: ScoringClient,
  item: ItemData,
  voice: string,
  target: Target,
  pcm16k: Float32Array,
  pitch: PitchFrame[],
  speech: [number, number],
  source: Run["source"],
): Promise<Run> {
  const sel = pick(item, target);
  const ref = sel.refs.find((r) => r.voice === voice) ?? sel.refs[0];
  const t0 = performance.now();
  const result = await client.score(pcm16k, sel.words, { ...sel.scoring, alignTo: ref.phones });
  const ms = Math.round(performance.now() - t0);
  let prosody: ProsodyResult | null = null;
  if (result.alignedTo) {
    const refTake: ProsodyTake = { phones: ref.phones, pitch: unpackPitch(ref.pitch), speech: ref.speech };
    const userTake: ProsodyTake = { phones: result.alignedTo, pitch, speech };
    prosody = compareProsody(refTake, userTake, sel.words.map((w) => w.text.toLowerCase()));
  }
  return { source, result, prosody, ms };
}

function summarize(run: Run, backend: string | null): Summary {
  return {
    backend,
    sounds: run.result.sounds,
    words: run.result.words.map((w) => [w.text, w.score]),
    flagged: run.result.words.flatMap((w) => w.phones.filter((p) => p.issue).map((p) => `${w.text}.${p.phone}:${p.issue}${p.heardAs ? ">" + p.heardAs : ""}`)),
    rhythm: run.prosody ? Math.round(run.prosody.rhythm) : null,
    intonation: run.prosody ? Math.round(run.prosody.intonation) : null,
    timing: run.result.timing,
    wallMs: run.ms,
  };
}

function RunView({ run }: { run: Run }) {
  const r = run.result;
  const cell = { padding: "2px 8px", borderBottom: "1px solid var(--pt-line)", verticalAlign: "top" as const };
  return (
    <section>
      <p style={{ margin: "0 0 8px" }}>
        <b>sounds {r.sounds}</b>
        {run.prosody ? ` · rhythm ${Math.round(run.prosody.rhythm)} · intonation ${Math.round(run.prosody.intonation)} · fluency ${Math.round(run.prosody.fluency)}` : ""} ·{" "}
        {run.source} · {run.ms} ms (mel {r.timing.mel} + model {r.timing.model} + align {r.timing.align}) on {r.backend}
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 480 }}>
          <thead>
            <tr>
              <th style={cell}>word</th>
              <th style={cell}>score</th>
              <th style={cell}>variant</th>
              <th style={cell}>phones</th>
            </tr>
          </thead>
          <tbody>
            {r.words.map((w, i) => (
              <tr key={i}>
                <td style={cell}>{w.text}</td>
                <td style={cell}>{w.score}</td>
                <td style={cell}>{w.variant}</td>
                <td style={cell}>
                  {w.phones.map((p, j) => (
                    <span key={j} style={{ marginRight: 8, color: p.issue ? "#b00020" : undefined }}>
                      {p.phone}:{Math.round(p.score)}
                      {p.issue ? `(${p.issue}${p.heardAs ? ` → ${p.heardAs}` : ""})` : ""}
                    </span>
                  ))}
                  {r.insertions
                    .filter((x) => x.wordIndex === i)
                    .map((x, k) => (
                      <span key={`i${k}`} style={{ marginRight: 8, color: "#b00020" }}>
                        +{x.vowel} after {w.phones[x.afterPhoneIndex]?.phone}
                      </span>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ margin: "8px 0", color: "var(--pt-soft)" }}>heard: {r.heard.join(" ")}</p>
      {run.prosody?.issues.length ? (
        <p style={{ margin: "0 0 8px" }}>prosody: {run.prosody.issues.map((x) => `${x.kind}${x.word !== undefined ? `@${x.word}` : ""}`).join(", ")}</p>
      ) : null}
    </section>
  );
}
