"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BreakText from "@/components/BreakText";
import {
  MicRecorder,
  Player,
  analyzePitch,
  audioCore,
  encodeWav,
  resample,
  type LevelEvent,
  type PitchFrame,
  type PlayheadEvent,
  type RecorderDiagnostics,
  type RecorderState,
  type Take,
} from "@/engine/audio";

/**
 * /lab — engineering test bench for src/engine/audio (noindex, plain styling).
 * Also the target of tools/e2e/lab.e2e.mjs, through `window.__lab`.
 */

const WORKLET_URL = "/worklets/mic-capture.js";
const DEFAULT_REF = "/audio/am_michael/t01_rice.mp3";
const F_LO = 60;
const F_HI = 520;
const LIVE_WINDOW = 4; // seconds of live pitch on screen

type RefAudio = { url: string; buffer: AudioBuffer; mono: Float32Array; pitch: PitchFrame[]; decodeMs: number };
type Sel = { t0: number; t1: number } | null;
type LabEvent = { type: string; t?: number; at: number; detail?: string };
type Playhead = { target: "take" | "ref"; t: number } | null;

type LabHook = {
  readonly state: RecorderState;
  readonly takes: number;
  readonly events: LabEvent[];
  readonly diagnostics: RecorderDiagnostics | null;
  readonly levelEvents: number;
  exportTake: (index?: number) => unknown;
  loadRef: (url: string) => Promise<{ duration: number; sampleRate: number; frames: number; voiced: number; decodeMs: number }>;
  /** play the last take ("take"), 0.5–1.0 s of it ("segment") or reference → take ("ab"), and report the playhead */
  playTest: (kind: "take" | "segment" | "ab") => Promise<PlayTestResult>;
};

type PlayTestResult = {
  completed: boolean;
  wallMs: number;
  expectedMs: number;
  events: number;
  labels: (string | undefined)[];
  /** per item: first and last playhead position */
  spans: { item: number; first: number; last: number }[];
  /** playhead never went backwards inside an item */
  monotonic: boolean;
};

declare global {
  interface Window {
    __lab?: LabHook;
  }
}

function f32ToB64(a: Float32Array): string {
  const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function mixdown(b: AudioBuffer): Float32Array {
  if (b.numberOfChannels === 1) return b.getChannelData(0).slice();
  const out = new Float32Array(b.length);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const ch = b.getChannelData(c);
    for (let i = 0; i < b.length; i++) out[i] += ch[i] / b.numberOfChannels;
  }
  return out;
}

function fit(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext("2d");
  g?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

const yOfHz = (f: number, h: number) => h - (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * h;

const peakCache = new WeakMap<Float32Array, { cols: number; data: Float32Array }>();
function peaks(pcm: Float32Array, cols: number): Float32Array {
  const c = peakCache.get(pcm);
  if (c && c.cols === cols) return c.data;
  const out = new Float32Array(cols * 2);
  const step = pcm.length / cols;
  for (let k = 0; k < cols; k++) {
    let mn = 0;
    let mx = 0;
    for (let i = Math.floor(k * step), b = Math.min(pcm.length, Math.floor((k + 1) * step)); i < b; i++) {
      const v = pcm[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    out[2 * k] = mn;
    out[2 * k + 1] = mx;
  }
  peakCache.set(pcm, { cols, data: out });
  return out;
}

function drawPitchLine(g: CanvasRenderingContext2D, frames: PitchFrame[], x: (t: number) => number, h: number) {
  g.beginPath();
  let pen = false;
  let prev: PitchFrame | null = null;
  for (const f of frames) {
    if (f.f0 === null) {
      pen = false;
      prev = f;
      continue;
    }
    const X = x(f.t);
    const Y = yOfHz(f.f0, h);
    const jump = prev && prev.f0 !== null && Math.abs(Math.log2(f.f0 / prev.f0)) > 0.25;
    if (!pen || jump) g.moveTo(X, Y);
    else g.lineTo(X, Y);
    pen = true;
    prev = f;
  }
  g.stroke();
}

function drawWave(
  canvas: HTMLCanvasElement,
  pcm: Float32Array,
  sampleRate: number,
  o: { pitch?: PitchFrame[]; speech?: { start: number; end: number } | null; sel?: Sel; playhead?: number | null },
) {
  const g = fit(canvas);
  if (!g) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dur = pcm.length / sampleRate || 1;
  const x = (t: number) => (t / dur) * w;
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#f4f4f7";
  g.fillRect(0, 0, w, h);
  if (o.speech) {
    g.fillStyle = "rgba(60,140,255,0.13)";
    g.fillRect(x(o.speech.start), 0, x(o.speech.end) - x(o.speech.start), h);
  }
  if (o.sel) {
    g.fillStyle = "rgba(255,180,0,0.35)";
    g.fillRect(x(o.sel.t0), 0, Math.max(1, x(o.sel.t1) - x(o.sel.t0)), h);
  }
  const cols = Math.max(1, Math.floor(w));
  const pk = peaks(pcm, cols);
  g.fillStyle = "#3d3b48";
  for (let k = 0; k < cols; k++) {
    const y0 = h / 2 - pk[2 * k + 1] * (h / 2);
    const y1 = h / 2 - pk[2 * k] * (h / 2);
    g.fillRect(k, y0, 1, Math.max(1, y1 - y0));
  }
  if (o.pitch) {
    g.strokeStyle = "#d6336c";
    g.lineWidth = 2;
    drawPitchLine(g, o.pitch, x, h);
  }
  if (o.playhead !== null && o.playhead !== undefined) {
    g.fillStyle = "#111";
    g.fillRect(x(o.playhead) - 1, 0, 2, h);
  }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "–";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 3 : 1);
  if (typeof v === "object") return JSON.stringify(v, (_k, x) => (typeof x === "number" && !Number.isInteger(x) ? Math.round(x * 1000) / 1000 : x));
  return String(v);
}

function Row({ k, v }: { k: string; v: unknown }) {
  return (
    <div className="flex gap-2 border-b border-line py-0.5">
      <span className="w-44 shrink-0 text-soft">{k}</span>
      <span className="min-w-0 break-all">{fmt(v)}</span>
    </div>
  );
}

export default function Lab() {
  const [recState, setRecState] = useState<RecorderState>("idle");
  const [take, setTake] = useState<Take | null>(null);
  const [ref, setRef] = useState<RefAudio | null>(null);
  const [refUrl, setRefUrl] = useState(DEFAULT_REF);
  const [sel, setSel] = useState<Sel>(null);
  const [diag, setDiag] = useState<RecorderDiagnostics | null>(null);
  const [events, setEvents] = useState<LabEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ec, setEc] = useState(false);
  const [ns, setNs] = useState(false);
  const [agc, setAgc] = useState(true);
  const [forceSP, setForceSP] = useState(false);
  const [env, setEnv] = useState<Record<string, unknown>>({});
  const [downloads, setDownloads] = useState<{ orig: string; m16: string } | null>(null);

  const recRef = useRef<MicRecorder | null>(null);
  const playerRef = useRef<Player | null>(null);
  const takesRef = useRef<{ take: Take; live: PitchFrame[]; levels: number; diag: RecorderDiagnostics }[]>([]);
  const eventsRef = useRef<LabEvent[]>([]);
  const live = useRef<{ level: LevelEvent | null; pitch: PitchFrame[]; levels: number; peakHold: number }>({ level: null, pitch: [], levels: 0, peakHold: -100 });
  const playhead = useRef<Playhead>(null);
  const dragSel = useRef<Sel>(null);
  const takeRef = useRef<Take | null>(null);
  const refRef = useRef<RefAudio | null>(null);
  const selRef = useRef<Sel>(null);
  const vuCanvas = useRef<HTMLCanvasElement>(null);
  const pitchCanvas = useRef<HTMLCanvasElement>(null);
  const takeCanvas = useRef<HTMLCanvasElement>(null);
  const refCanvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    takeRef.current = take;
    refRef.current = ref;
    selRef.current = sel;
  }, [take, ref, sel]);

  const player = useCallback((): Player => {
    if (!playerRef.current) {
      playerRef.current = new Player({
        onPlayhead: (e) => {
          playhead.current = { target: e.label === "native" ? "ref" : "take", t: e.t };
        },
        onEnd: () => {
          playhead.current = null;
        },
      });
    }
    return playerRef.current;
  }, []);

  const log = useCallback((type: string, t?: number, detail?: string) => {
    const e: LabEvent = { type, t, at: Math.round(performance.now()), detail };
    eventsRef.current = [...eventsRef.current.slice(-199), e];
    setEvents(eventsRef.current);
  }, []);

  // environment facts (client only)
  useEffect(() => {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    setEnv({
      crossOriginIsolated: window.crossOriginIsolated,
      isSecureContext: window.isSecureContext,
      sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
      audioWorklet: typeof AudioWorkletNode !== "undefined",
      audioSession: nav.audioSession ? nav.audioSession.type : "unsupported",
      getUserMedia: !!navigator.mediaDevices?.getUserMedia,
      userAgent: navigator.userAgent,
    });
    return audioCore.onChange((ctx, state) => log("context", undefined, `${state} @ ${ctx.sampleRate} Hz`));
  }, [log]);

  // live diagnostics while recording
  useEffect(() => {
    if (recState !== "recording") return;
    const id = setInterval(() => recRef.current && setDiag({ ...recRef.current.diagnostics }), 500);
    return () => clearInterval(id);
  }, [recState]);

  // WAV downloads for the current take
  useEffect(() => {
    if (!take) return;
    const orig = URL.createObjectURL(new Blob([encodeWav(take.pcm, take.sampleRate)], { type: "audio/wav" }));
    const m16 = URL.createObjectURL(new Blob([encodeWav(take.pcm16k, 16000)], { type: "audio/wav" }));
    setDownloads({ orig, m16 });
    return () => {
      URL.revokeObjectURL(orig);
      URL.revokeObjectURL(m16);
    };
  }, [take]);

  // 60 fps canvases
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const L = live.current;
      // VU meter: -80…0 dBFS, floor marker, onset threshold, peak hold
      const vu = vuCanvas.current;
      const g = vu && fit(vu);
      if (vu && g) {
        const w = vu.clientWidth;
        const h = vu.clientHeight;
        const X = (db: number) => (Math.min(0, Math.max(-80, db)) / 80 + 1) * w;
        g.fillStyle = "#eeeef2";
        g.fillRect(0, 0, w, h);
        const lv = L.level;
        if (lv) {
          L.peakHold = Math.max(L.peakHold - 0.4, 20 * Math.log10(Math.max(lv.peak, 1e-5)));
          g.fillStyle = lv.clipped ? "#e03131" : lv.speaking ? "#2f9e44" : "#868e96";
          g.fillRect(0, 0, X(lv.db), h);
          g.fillStyle = "#212529";
          g.fillRect(X(L.peakHold) - 1, 0, 2, h);
          g.fillStyle = "#1c7ed6";
          g.fillRect(X(lv.floorDb) - 1, 0, 2, h);
          g.fillStyle = "rgba(28,126,214,0.35)";
          g.fillRect(X(lv.floorDb + 10) - 1, 0, 2, h);
        }
      }
      // live pitch line (last LIVE_WINDOW seconds)
      const pc = pitchCanvas.current;
      const pg = pc && fit(pc);
      if (pc && pg) {
        const w = pc.clientWidth;
        const h = pc.clientHeight;
        pg.fillStyle = "#101014";
        pg.fillRect(0, 0, w, h);
        pg.fillStyle = "#3a3a44";
        pg.font = "10px system-ui";
        for (const f of [100, 200, 300, 400]) {
          const y = yOfHz(f, h);
          pg.fillRect(0, y, w, 1);
          pg.fillText(`${f}`, 2, y - 2);
        }
        const fr = L.pitch;
        if (fr.length) {
          const tEnd = Math.max(LIVE_WINDOW, fr[fr.length - 1].t);
          const x = (t: number) => ((t - (tEnd - LIVE_WINDOW)) / LIVE_WINDOW) * w;
          let i = fr.length - 1;
          while (i > 0 && fr[i].t > tEnd - LIVE_WINDOW) i--;
          pg.strokeStyle = "#ffd23f";
          pg.lineWidth = 3;
          pg.lineJoin = "round";
          drawPitchLine(pg, fr.slice(i), x, h);
        }
      }
      // take + reference waveforms with playhead / selection
      const tk = takeRef.current;
      if (tk && takeCanvas.current) {
        drawWave(takeCanvas.current, tk.pcm, tk.sampleRate, {
          pitch: tk.pitch,
          speech: tk.speech,
          sel: dragSel.current ?? selRef.current,
          playhead: playhead.current?.target === "take" ? playhead.current.t : null,
        });
      }
      const rf = refRef.current;
      if (rf && refCanvas.current) {
        drawWave(refCanvas.current, rf.mono, rf.buffer.sampleRate, {
          pitch: rf.pitch,
          playhead: playhead.current?.target === "ref" ? playhead.current.t : null,
        });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onRecord = () => {
    const cur = recRef.current;
    if (cur && cur.state !== "idle") {
      cur.stop();
      return;
    }
    setError(null);
    player().stop();
    const L = live.current;
    L.pitch = [];
    L.levels = 0;
    L.level = null;
    const rec = new MicRecorder(
      {
        workletUrl: WORKLET_URL,
        constraints: { echoCancellation: ec, noiseSuppression: ns, autoGainControl: agc },
        forceScriptProcessor: forceSP,
        keepRaw: true,
      },
      {
        onLevel: (e) => {
          L.level = e;
          L.levels++;
        },
        onPitch: (f) => {
          L.pitch.push(f);
        },
        onSpeechStart: (e) => log("speech-start", e.t),
        onSpeechEnd: (e) => log(e.rejected ? "speech-rejected" : "speech-end", e.t),
        onStateChange: (s) => {
          setRecState(s);
          log(`state:${s}`);
          if (s === "idle") L.level = null; // don't leave the meter frozen at the last level
        },
      },
    );
    recRef.current = rec;
    // record() is called synchronously in the click handler (iOS gesture rule)
    rec
      .record()
      .then((t) => {
        takesRef.current.push({ take: t, live: L.pitch, levels: L.levels, diag: { ...rec.diagnostics } });
        setTake(t);
        setSel(null);
        setDiag({ ...rec.diagnostics });
        log("take", t.duration, `${t.stopReason}, speech ${t.speech ? `${t.speech.start.toFixed(2)}–${t.speech.end.toFixed(2)}` : "none"}`);
      })
      .catch((e: unknown) => {
        setError(String((e as Error)?.message ?? e));
        setDiag({ ...rec.diagnostics });
        log("error", undefined, String((e as Error)?.message ?? e));
      });
  };

  const loadRef = useCallback(
    async (url: string) => {
      const t0 = performance.now();
      const buffer = await player().load(url);
      const decodeMs = performance.now() - t0;
      const mono = mixdown(buffer);
      const pitch = analyzePitch(resample(mono, buffer.sampleRate, 16000));
      const r: RefAudio = { url, buffer, mono, pitch, decodeMs };
      setRef(r);
      log("ref", buffer.duration, `${url} (${buffer.sampleRate} Hz, decode ${decodeMs.toFixed(0)} ms)`);
      return r;
    },
    [log, player],
  );

  // test hook
  useEffect(() => {
    window.__lab = {
      get state() {
        return recRef.current?.state ?? "idle";
      },
      get takes() {
        return takesRef.current.length;
      },
      get events() {
        return eventsRef.current;
      },
      get diagnostics() {
        return recRef.current ? { ...recRef.current.diagnostics } : null;
      },
      get levelEvents() {
        return live.current.levels;
      },
      exportTake(index = -1) {
        const e = takesRef.current.at(index);
        if (!e) return null;
        const t = e.take;
        return {
          sampleRate: t.sampleRate,
          duration: t.duration,
          offset: t.offset,
          speech: t.speech,
          stopReason: t.stopReason,
          stats: t.stats,
          pitch: t.pitch,
          pcmLength: t.pcm.length,
          pcm16kB64: f32ToB64(t.pcm16k),
          raw: t.raw && { speech: t.raw.speech, pcmLength: t.raw.pcm.length, pcm16kB64: f32ToB64(t.raw.pcm16k), pitch: t.raw.pitch, levels: Array.from(t.raw.levels) },
          live: e.live,
          levelEvents: e.levels,
          diagnostics: e.diag,
        };
      },
      async loadRef(url: string) {
        const r = await loadRef(url);
        return { duration: r.buffer.duration, sampleRate: r.buffer.sampleRate, frames: r.pitch.length, voiced: r.pitch.filter((f) => f.f0 !== null).length, decodeMs: r.decodeMs };
      },
      async playTest(kind) {
        const tk = takeRef.current;
        const rf = refRef.current;
        if (!tk || (kind === "ab" && !rf)) throw new Error("record a take (and load a reference for ab) first");
        const mine = { pcm: tk.pcm, sampleRate: tk.sampleRate };
        const heads: PlayheadEvent[] = [];
        const p = new Player({ onPlayhead: (e) => heads.push(e) });
        const gap = 0.2;
        const t0 = performance.now();
        let completed: boolean;
        let expectedMs: number;
        if (kind === "take") {
          completed = await p.play(mine, { label: "mine" });
          expectedMs = tk.duration * 1000;
        } else if (kind === "segment") {
          completed = await p.playSegment(mine, 0.5, 1.0);
          expectedMs = 500;
        } else {
          const ref = (rf as RefAudio).buffer;
          completed = await p.playSequence([{ source: ref, label: "native" }, { source: mine, label: "mine" }], { gap });
          expectedMs = (ref.duration + gap + tk.duration) * 1000;
        }
        const wallMs = performance.now() - t0;
        const spans: PlayTestResult["spans"] = [];
        let monotonic = true;
        heads.forEach((h, i) => {
          const s = spans.find((x) => x.item === h.item);
          if (!s) spans.push({ item: h.item, first: h.t, last: h.t });
          else {
            if (h.t < s.last - 1e-6) monotonic = false;
            s.last = h.t;
          }
          if (i > 0 && h.item < heads[i - 1].item) monotonic = false;
        });
        return { completed, wallMs, expectedMs, events: heads.length, labels: [...new Set(heads.map((h) => h.label))], spans, monotonic };
      },
    };
    return () => {
      delete window.__lab;
    };
  }, [loadRef]);

  const takePlayable = take ? { pcm: take.pcm, sampleRate: take.sampleRate } : null;

  const tAt = (e: React.PointerEvent<HTMLCanvasElement>): number => {
    const r = e.currentTarget.getBoundingClientRect();
    const dur = take ? take.duration : 0;
    return Math.min(dur, Math.max(0, ((e.clientX - r.left) / r.width) * dur));
  };

  const busy = recState === "starting" || recState === "stopping";
  const recLabel = recState === "recording" ? "■ 停止" : recState === "idle" ? "● 録音" : "…";

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-[14px]">
      <h1 className="text-lg font-bold">audio lab</h1>
      <p className="text-soft">
        <BreakText text="src/engine/audio の試験台。◆録音はしゃべり終わると自動で止まる。◆タップでも止まる。" />
      </p>

      <section className="mt-4 flex flex-wrap items-center gap-3">
        <button
          id="record"
          type="button"
          onClick={onRecord}
          disabled={busy}
          className={`min-w-28 rounded border px-4 py-3 text-base font-bold ${recState === "recording" ? "border-red-600 bg-red-600 text-white" : "border-ink"}`}
        >
          {recLabel}
        </button>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={ec} onChange={(e) => setEc(e.target.checked)} disabled={recState !== "idle"} />
          echoCancellation
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={ns} onChange={(e) => setNs(e.target.checked)} disabled={recState !== "idle"} />
          noiseSuppression
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={agc} onChange={(e) => setAgc(e.target.checked)} disabled={recState !== "idle"} />
          autoGainControl
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={forceSP} onChange={(e) => setForceSP(e.target.checked)} disabled={recState !== "idle"} />
          ScriptProcessor
        </label>
        <span id="rec-state" className="text-soft">
          {recState}
        </span>
      </section>
      {error && <p className="mt-2 text-red-700">エラー: {error}</p>}

      <section className="mt-4">
        <div className="text-soft">
          <BreakText text="level（灰=静か / 緑=発話中 / ◆青線=ノイズの床 / 薄青=発話の閾値）" />
        </div>
        <canvas ref={vuCanvas} className="mt-1 block h-4 w-full" />
        <div className="mt-3 text-soft">live pitch（直近 {LIVE_WINDOW} 秒・60〜520 Hz 対数）</div>
        <canvas ref={pitchCanvas} className="mt-1 block h-40 w-full rounded" />
      </section>

      <section className="mt-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">自分の録音</span>
          <button type="button" className="rounded border px-3 py-1" disabled={!takePlayable} onClick={() => takePlayable && player().play(takePlayable, { label: "mine" })}>
            ▶ 再生
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1"
            disabled={!takePlayable || !sel}
            onClick={() => takePlayable && sel && player().playSegment(takePlayable, sel.t0, sel.t1)}
          >
            ▶ 選択範囲
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1"
            disabled={!takePlayable || !ref}
            onClick={() => takePlayable && ref && player().playSequence([{ source: ref.buffer, label: "native" }, { source: takePlayable, label: "mine" }])}
          >
            ▶ お手本→自分
          </button>
          <button type="button" className="rounded border px-3 py-1" onClick={() => player().stop()}>
            ■
          </button>
          {downloads && (
            <>
              <a className="underline" href={downloads.orig} download="take.wav">
                WAV
              </a>
              <a className="underline" href={downloads.m16} download="take-16k.wav">
                WAV 16k
              </a>
            </>
          )}
        </div>
        <canvas
          ref={takeCanvas}
          className="mt-2 block h-32 w-full touch-none rounded bg-[#f4f4f7]"
          onPointerDown={(e) => {
            if (!take) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const t = tAt(e);
            dragSel.current = { t0: t, t1: t };
          }}
          onPointerMove={(e) => {
            const d = dragSel.current;
            if (!d) return;
            const t = tAt(e);
            dragSel.current = { t0: d.t0, t1: t };
          }}
          onPointerUp={(e) => {
            const d = dragSel.current;
            dragSel.current = null;
            if (!d || !takePlayable) return;
            const t1 = tAt(e);
            const a = Math.min(d.t0, t1);
            const b = Math.max(d.t0, t1);
            if (b - a < 0.03) {
              setSel(null);
              return;
            }
            setSel({ t0: a, t1: b });
            player().playSegment(takePlayable, a, b); // pointerup is a user gesture
          }}
        />
        <p className="mt-1 text-soft">
          <BreakText text="波形をドラッグすると、◆その範囲だけ再生する。◇青＝VADの発話区間、◆赤線＝音程。" />
        </p>
      </section>

      <section className="mt-5">
        <div className="font-bold">お手本の音声</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input className="min-w-0 flex-1 rounded border px-2 py-1" value={refUrl} onChange={(e) => setRefUrl(e.target.value)} />
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={() => {
              loadRef(refUrl).catch((e: unknown) => setError(String((e as Error)?.message ?? e)));
            }}
          >
            読み込む
          </button>
          <button type="button" className="rounded border px-3 py-1" disabled={!ref} onClick={() => ref && player().play(ref.buffer, { label: "native" })}>
            ▶ お手本
          </button>
        </div>
        {ref && <canvas ref={refCanvas} className="mt-2 block h-24 w-full rounded" />}
      </section>

      <section className="mt-6 font-mono text-[12px]">
        <div className="font-bold">環境</div>
        {Object.entries(env).map(([k, v]) => (
          <Row key={k} k={k} v={v} />
        ))}
        <div className="mt-3 font-bold">録音エンジン</div>
        {diag ? (
          <>
            <Row k="captureMode" v={diag.captureMode} />
            <Row k="workletSource" v={diag.workletSource} />
            <Row k="workletError" v={diag.workletError} />
            <Row k="contextRate / captureRate" v={`${diag.contextRate} / ${diag.captureRate}`} />
            <Row k="contextState" v={diag.contextState} />
            <Row k="baseLatency / outputLatency" v={`${fmt(diag.baseLatencyMs)} / ${fmt(diag.outputLatencyMs)} ms`} />
            <Row k="audioSession" v={diag.sessionType} />
            <Row k="contextRecreated" v={diag.contextRecreated} />
            <Row k="track" v={diag.track?.label} />
            <Row k="track settings" v={diag.track?.settings} />
            <Row k="track stats" v={diag.trackStats} />
            <Row k="startup (tap→audio)" v={diag.startupMs !== null ? `${diag.startupMs.toFixed(0)} ms` : null} />
            <Row k="chunks / gaps / dropped" v={`${diag.chunks} / ${diag.frameGaps} / ${diag.droppedFrames}`} />
            <Row k="gap log" v={diag.gapLog} />
            <Row k="startup gap frames" v={diag.startupGapFrames} />
            <Row k="lastError" v={diag.lastError} />
          </>
        ) : (
          <div className="text-soft">まだ録音していない</div>
        )}
        {take && (
          <>
            <div className="mt-3 font-bold">直近のテイク</div>
            <Row k="stopReason" v={take.stopReason} />
            <Row k="duration / raw" v={`${take.duration.toFixed(3)} s / ${take.stats.rawDuration.toFixed(3)} s`} />
            <Row k="offset (trim start)" v={`${take.offset.toFixed(3)} s`} />
            <Row k="speech (in take)" v={take.speech} />
            <Row k="speech (raw)" v={take.raw?.speech} />
            <Row k="samples" v={`${take.pcm.length} @ ${take.sampleRate} Hz, ${take.pcm16k.length} @ 16 kHz`} />
            <Row k="floor / speech peak" v={`${take.stats.floorDb.toFixed(1)} / ${take.stats.speechPeakDb.toFixed(1)} dBFS`} />
            <Row k="pitch frames (voiced)" v={`${take.pitch.length} (${take.pitch.filter((f) => f.f0 !== null).length})`} />
            <Row k="pitch latency ms" v={take.stats.pitchLatencyMs} />
            <Row k="transport latency ms" v={take.stats.transportLatencyMs} />
            <Row k="DSP load" v={`${(take.stats.dspLoad * 100).toFixed(2)} %`} />
            <Row k="VAD events" v={take.stats.vadEvents} />
          </>
        )}
        <div className="mt-3 font-bold">イベント</div>
        <div className="max-h-48 overflow-auto">
          {events
            .slice()
            .reverse()
            .map((e, i) => (
              <div key={i} className="border-b border-line py-0.5">
                {e.at} ms · {e.type}
                {e.t !== undefined ? ` t=${e.t.toFixed(3)}` : ""} {e.detail ?? ""}
              </div>
            ))}
        </div>
      </section>
    </main>
  );
}
