"use client";

/**
 * The pitch lane (音程レーン) — the one bold thing.
 * Canvas, redrawn only when something moved; time-critical values (playhead, live points)
 * come in through refs so React never re-renders at 60 fps.
 *
 *   guide   : the model's bars; a cursor lights them while the model plays
 *   live    : the guide cursor runs; your line draws over the bars; bars fill where you match
 *             (fills come from KaraokeJudge when given, otherwise from the line itself)
 *   warp    : right after the take (your line slides onto the model's timing when morph data is given)
 *   overlay : both melodies on the model's timeline; `progressive` redraws yours with the replay
 *
 * Every time is on the guide (model) timeline of the chosen speed.
 */
import { useEffect, useRef } from "react";
import type { ContourPoint, LaneSyllable, WordSpan } from "../types";
import {
  barLine,
  fallbackHeights,
  laneFrame,
  lineAt,
  normProminence,
  timeMap,
  xOf,
  yOf,
  type LaneBox,
  type LaneFrame,
} from "./geometry";

export type LaneMode = "guide" | "live" | "warp" | "overlay";
export type Clock = { current: number | null };
/** Your live line and the guide cursor, both on the guide timeline (seconds). */
export type LiveTake = { points: ContourPoint[]; t: number | null };
/** How full each bar is (0..1) and its grade once decided — KaraokeJudge.bars fits as is. */
export type BarFill = { fill: number; grade: "perfect" | "great" | "good" | "miss" | null };
export type FinishedTake = {
  /** your contour on the model's timeline */
  onRef: ContourPoint[];
  /** optional morph data (mock): your contour on your own timeline, its syllables, voice onset */
  contour?: ContourPoint[];
  syllables?: LaneSyllable[];
  onset?: number;
};

export const LANE_PAD = { l: 14, r: 14, t: 18, b: 30 };

export type PitchLaneProps = {
  syllables: LaneSyllable[];
  contour?: ContourPoint[];
  words: WordSpan[];
  mode: LaneMode;
  /** model-timeline seconds while something plays; null when stopped */
  playhead?: Clock;
  playheadTone?: "guide" | "voice";
  live?: { current: LiveTake };
  /** live bar fills (read every frame); kept after the take as the record of what matched */
  fills?: { current: readonly BarFill[] | null } | null;
  take?: FinishedTake | null;
  /** your previous best, on the model's timeline, drawn faintly */
  ghost?: ContourPoint[] | null;
  /** overlay: draw your line only up to the playhead (replay) */
  progressive?: boolean;
  focusWord?: number | null;
  /** shared with overlays so pops land on the bars */
  frame?: LaneFrame;
  /** spoken summary for screen readers */
  label: string;
  className?: string;
};

type Palette = {
  guide: [number, number, number];
  voice: [number, number, number];
  monitor: [number, number, number];
  muted: string;
  font: string;
};

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.trim().replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
};
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export default function PitchLane(props: PitchLaneProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const versionRef = useRef(0);
  const warpStartRef = useRef<number | null>(null);

  // Latest props for the loop; bump a version so the loop redraws once.
  useEffect(() => {
    if (props.mode === "warp" && propsRef.current.mode !== "warp") warpStartRef.current = null;
    propsRef.current = props;
    versionRef.current++;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cs = getComputedStyle(wrap);
    const pal: Palette = {
      guide: hexToRgb(cs.getPropertyValue("--guide") || "#62cbff"),
      voice: hexToRgb(cs.getPropertyValue("--voice") || "#ffd23f"),
      monitor: hexToRgb(cs.getPropertyValue("--monitor") || "#0c0f33"),
      muted: cs.getPropertyValue("--monitor-muted").trim() || "#a8acd9",
      font: cs.fontFamily,
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    let box: LaneBox = { w: 0, h: 0, padL: LANE_PAD.l, padR: LANE_PAD.r, padT: LANE_PAD.t, padB: LANE_PAD.b };
    let dpr = 1;
    let sized = false;
    let dirty = true;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      box = { ...box, w: r.width, h: r.height };
      const cw = Math.max(1, Math.round(r.width * dpr));
      const ch = Math.max(1, Math.round(r.height * dpr));
      // assigning width clears the canvas even when unchanged: only touch it when it changed, and redraw
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      sized = r.width > 0 && r.height > 0;
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    // canvas text needs the web font: redraw once it is in
    document.fonts?.ready.then(() => {
      pal.font = getComputedStyle(wrap).fontFamily;
      dirty = true;
    });

    // per-data caches
    let cacheKey: unknown = null;
    let lines: [number, number][][] = [];
    let prom: number[] = [];
    const prepare = (p: PitchLaneProps) => {
      if (cacheKey === p.syllables) return;
      cacheKey = p.syllables;
      const fb = fallbackHeights(p.syllables);
      lines = p.syllables.map((s, i) => barLine(s, p.contour, fb[i]));
      prom = normProminence(p.syllables);
    };

    let lastSig = "";
    let raf = 0;

    const draw = (now: number) => {
      const p = propsRef.current;
      prepare(p);
      const f = p.frame ?? laneFrame(p.syllables, [p.contour, p.take?.onRef, p.ghost]);
      const W = box.w;
      const H = box.h;
      const scale = Math.max(0.85, Math.min(1.8, H / 170));
      const X = (t: number) => xOf(box, f, t);
      const Y = (st: number) => yOf(box, f, st);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // staff lines every 2 semitones (quiet)
      ctx.strokeStyle = "rgba(255,255,255,0.055)";
      ctx.lineWidth = 1;
      for (let st = Math.ceil(f.st0 / 2) * 2; st <= f.st1; st += 2) {
        const y = Math.round(Y(st)) + 0.5;
        if (y < box.padT - 4 || y > H - box.padB + 2) continue;
        ctx.beginPath();
        ctx.moveTo(box.padL - 6, y);
        ctx.lineTo(W - box.padR + 6, y);
        ctx.stroke();
      }

      const ph = p.playhead?.current ?? null;
      const live = p.live?.current;
      const laneNow = p.mode === "live" && live && live.t !== null ? live.t : null;
      const fills = p.fills?.current ?? null;

      const strokeBar = (i: number, width: number, color: string) => {
        const L = lines[i];
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(X(L[0][0]) + width / 2 + 1, Y(L[0][1]));
        for (let k = 1; k < L.length; k++) {
          const isLast = k === L.length - 1;
          ctx.lineTo(X(L[k][0]) - (isLast ? width / 2 + 1 : 0), Y(L[k][1]));
        }
        ctx.stroke();
      };
      const barWidth = (i: number) => (6 + 10 * prom[i]) * scale;

      // 1) every bar, at rest
      const settled = p.mode === "warp" || p.mode === "overlay";
      const rest = settled ? 0.7 : 0.4;
      p.syllables.forEach((_, i) => {
        strokeBar(i, barWidth(i) + 6 * scale, rgba(pal.guide, 0.07 + 0.08 * prom[i]));
        strokeBar(i, barWidth(i), rgba(pal.guide, rest + 0.3 * prom[i]));
        if (settled) {
          // a quiet highlight so the comparison view keeps the "lit bar" look
          ctx.save();
          ctx.translate(0, -barWidth(i) * 0.16);
          strokeBar(i, Math.max(2, barWidth(i) * 0.26), "rgba(255,255,255,0.35)");
          ctx.restore();
        }
      });

      // 2) lit parts: under the model's cursor, or where your voice hit the bar
      const lit = (i: number, from: number, to: number, tone: [number, number, number] = pal.guide, alpha = 1) => {
        const x0 = X(from);
        const x1 = X(to);
        if (x1 <= x0) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, 0, x1 - x0, H);
        ctx.clip();
        const w = barWidth(i);
        strokeBar(i, w + 10 * scale, rgba(tone, 0.22 * alpha));
        strokeBar(i, w, rgba(tone, alpha));
        ctx.translate(0, -w * 0.16);
        strokeBar(i, Math.max(2, w * 0.3), `rgba(255,255,255,${0.75 * alpha})`);
        ctx.restore();
      };
      if (p.mode === "guide" && ph !== null) {
        p.syllables.forEach((s, i) => {
          if (ph > s.start) lit(i, s.start - 0.05, Math.min(ph, s.end + 0.05));
        });
      }
      if (fills && p.mode !== "guide") {
        // the judge's verdict: the matched share of each bar fills left → right in your colour
        p.syllables.forEach((s, i) => {
          const b = fills[i];
          if (!b || b.fill <= 0.02 || b.grade === "miss") return;
          const alpha = b.grade === "good" ? 0.6 : 1;
          lit(i, s.start - 0.05, s.start + (s.end - s.start) * Math.min(1, b.fill) + 0.05, pal.voice, alpha);
        });
      } else if (p.mode === "live" && live) {
        // runs of 10 ms frames whose pitch sat on the bar
        p.syllables.forEach((s, i) => {
          let runStart: number | null = null;
          let prevT = -1;
          const L = lines[i];
          for (const pt of live.points) {
            const t = pt.t;
            if (t < s.start || t > s.end) continue;
            const ok = pt.st !== null && Math.abs(pt.st - lineAt(L, t)) < 1.7;
            if (ok && runStart === null) runStart = t;
            if (!ok && runStart !== null) {
              lit(i, runStart, prevT + 0.01);
              runStart = null;
            }
            prevT = t;
          }
          if (runStart !== null) lit(i, runStart, prevT + 0.01);
        });
      }

      // 3) ghost of your previous best
      const strokeLine = (pts: ContourPoint[], xs: (pt: ContourPoint) => number, upTo: number | null) => {
        ctx.beginPath();
        let pen = false;
        for (const pt of pts) {
          if (upTo !== null && pt.t > upTo) break;
          if (pt.st === null) {
            pen = false;
            continue;
          }
          const x = xs(pt);
          const y = Y(pt.st);
          if (!pen) {
            ctx.moveTo(x, y);
            pen = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      if (p.ghost && (p.mode === "live" || p.mode === "overlay")) {
        ctx.save();
        ctx.setLineDash([2 * scale, 6 * scale]);
        ctx.strokeStyle = rgba(pal.voice, 0.5);
        ctx.lineWidth = 2.4 * scale;
        strokeLine(p.ghost, (pt) => X(pt.t), null);
        ctx.restore();
      }

      // 4) your line
      const voiceLine = (pts: ContourPoint[], xs: (pt: ContourPoint) => number, upTo: number | null) => {
        ctx.strokeStyle = rgba(pal.monitor, 0.9);
        ctx.lineWidth = 7 * scale;
        strokeLine(pts, xs, upTo);
        ctx.strokeStyle = rgba(pal.voice, 0.2);
        ctx.lineWidth = 11 * scale;
        strokeLine(pts, xs, upTo);
        ctx.strokeStyle = rgba(pal.voice, 1);
        ctx.lineWidth = 3.2 * scale;
        strokeLine(pts, xs, upTo);
      };
      let head: { x: number; y: number } | null = null;
      if (p.mode === "live" && live) {
        voiceLine(live.points, (pt) => X(pt.t), null);
        for (let k = live.points.length - 1; k >= 0; k--) {
          const pt = live.points[k];
          if (pt.st !== null) {
            if (live.t !== null && live.t - pt.t < 0.12) head = { x: X(pt.t), y: Y(pt.st) };
            break;
          }
        }
      }
      let morphing = false;
      if (p.mode === "warp") {
        const tk = p.take;
        if (tk?.contour && tk.syllables && tk.onset !== undefined) {
          if (warpStartRef.current === null) warpStartRef.current = now;
          const k = reduce.matches ? 1 : Math.min(1, (now - warpStartRef.current) / 650);
          morphing = k < 1;
          const e = ease(k);
          const map = timeMap(tk.syllables, p.syllables);
          const off = p.syllables[0].start - tk.onset;
          voiceLine(tk.contour, (pt) => X(pt.t + off) * (1 - e) + X(map(pt.t)) * e, null);
        } else if (live) {
          // real takes: keep the line as sung while the result is computed
          voiceLine(live.points, (pt) => X(pt.t), null);
        }
      }
      if (p.mode === "overlay" && p.take) {
        voiceLine(p.take.onRef, (pt) => X(pt.t), p.progressive ? ph ?? -1 : null);
      }

      // 5) focus on one word: dim the rest
      if (p.focusWord != null && p.words[p.focusWord]) {
        const w = p.words[p.focusWord];
        const a = X(w.start) - 6;
        const b = X(w.end) + 6;
        ctx.fillStyle = rgba(pal.monitor, 0.72);
        ctx.fillRect(0, 0, Math.max(0, a), H - box.padB + 4);
        ctx.fillRect(b, 0, Math.max(0, W - b), H - box.padB + 4);
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.strokeRect(a + 0.5, box.padT - 10.5, b - a - 1, H - box.padB - box.padT + 14);
        ctx.setLineDash([]);
      }

      // 6) cursor
      const cursor = (x: number, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, box.padT - 10);
        ctx.lineTo(x, H - box.padB + 2);
        ctx.stroke();
      };
      if (ph !== null && (p.mode === "guide" || p.mode === "overlay")) {
        const tone = p.playheadTone === "voice" ? pal.voice : pal.guide;
        cursor(X(ph), rgba(tone, 0.95));
      }
      if (laneNow !== null) cursor(X(laneNow), "rgba(255,255,255,0.55)");
      if (head) {
        ctx.fillStyle = rgba(pal.voice, 0.28);
        ctx.beginPath();
        ctx.arc(head.x, head.y, 10 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(head.x, head.y, 4.2 * scale, 0, Math.PI * 2);
        ctx.fill();
      }

      // 7) word labels under the lane
      ctx.textBaseline = "alphabetic";
      ctx.font = `800 ${Math.round(12 * Math.min(scale, 1.4))}px ${pal.font}`;
      p.words.forEach((w, i) => {
        const focused = p.focusWord === i;
        ctx.fillStyle = p.focusWord == null ? pal.muted : focused ? "#ffffff" : "rgba(168,172,217,0.45)";
        ctx.fillText(w.text, X(w.start) + 2, H - 10);
      });

      return morphing;
    };

    let morphing = false;
    const loop = (now: number) => {
      const p = propsRef.current;
      const live = p.live?.current;
      let fillSig = 0;
      const fl = p.fills?.current;
      if (fl) for (let i = 0; i < fl.length; i++) fillSig += fl[i].fill * (i + 1) + (fl[i].grade ? 7 * (i + 1) : 0);
      const sig = `${versionRef.current}|${p.playhead?.current ?? "-"}|${live?.points.length ?? 0}|${live?.t ?? "-"}|${fillSig.toFixed(3)}|${box.w}x${box.h}`;
      if (sized && (sig !== lastSig || morphing || dirty)) {
        dirty = false;
        morphing = draw(now);
        lastSig = sig;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className={props.className ?? "relative h-[184px]"}>
      <canvas ref={canvasRef} role="img" aria-label={props.label} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
