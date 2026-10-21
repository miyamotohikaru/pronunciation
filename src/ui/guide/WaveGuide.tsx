"use client";

/**
 * The guide as a wave: the model's melody as one thick, rounded, glowing ribbon (karaoke-bar
 * material), thickness from loudness, thinner where a consonant or a short gap is bridged.
 * While the guide runs it scrolls past a fixed "now" line at the chosen speed; each syllable's
 * stretch of ribbon fills left → right as KaraokeJudge's bar fills (waveFill), and turns to its
 * grade colour when decided. Your live line is drawn over it on the same semitone scale.
 *
 * Performance contract: one canvas, one requestAnimationFrame loop, inputs read from refs,
 * no React state and no layout reads per frame (the size comes from a ResizeObserver).
 */
import { memo, useEffect, useRef } from "react";
import { waveFill, type BarGrade, type WaveFill } from "@/engine/karaoke/judge.ts";
import type { GuideProps } from "./types";

const PAD = { l: 12, r: 12, t: 26, b: 30 };
/** follow mode: where "now" sits (share of the width) */
const NOW_X = 0.3;

type RGB = [number, number, number];
const rgb = (hex: string, fb: RGB): RGB => {
  const h = hex.trim().replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return Number.isFinite(n) && h.length >= 3 ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : fb;
};
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

type Pop = { i: number; grade: BarGrade; at: number };
const POP_MS = 950;
const POP_LABEL: Record<BarGrade, string> = { perfect: "PERFECT", great: "GREAT", good: "GOOD", miss: "" };

function WaveGuide(props: GuideProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const versionRef = useRef(0);

  useEffect(() => {
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
    const col = {
      guide: rgb(cs.getPropertyValue("--guide"), [98, 203, 255]),
      voice: rgb(cs.getPropertyValue("--voice"), [255, 210, 63]),
      hit: rgb(cs.getPropertyValue("--hit"), [255, 79, 163]),
      good: rgb(cs.getPropertyValue("--j-good"), [255, 182, 72]),
      great: rgb(cs.getPropertyValue("--j-great"), [91, 232, 154]),
      monitor: rgb(cs.getPropertyValue("--monitor"), [12, 15, 51]),
      muted: cs.getPropertyValue("--monitor-muted").trim() || "#a8acd9",
    };
    let font = cs.fontFamily;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    let W = 0;
    let H = 0;
    let dpr = 1;
    let dirty = true;
    const resize = (r: { width: number; height: number }) => {
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      W = r.width;
      H = r.height;
      const cw = Math.max(1, Math.round(W * dpr));
      const ch = Math.max(1, Math.round(H * dpr));
      if (canvas.width !== cw) canvas.width = cw; // assigning clears the canvas: only when it changed
      if (canvas.height !== ch) canvas.height = ch;
      dirty = true;
    };
    const ro = new ResizeObserver((entries) => resize(entries[0].contentRect));
    ro.observe(wrap);
    resize(wrap.getBoundingClientRect());
    document.fonts?.ready.then(() => {
      font = getComputedStyle(wrap).fontFamily;
      dirty = true;
    });

    // ---- per-wave geometry (recomputed only when the wave object changes)
    let geomKey: unknown = null;
    let t0 = 0;
    let t1 = 1;
    let st0 = -6;
    let st1 = 6;
    const prepare = () => {
      const p = propsRef.current;
      if (geomKey === p.wave) return;
      geomKey = p.wave;
      let lo = Infinity;
      let hi = -Infinity;
      let a = Infinity;
      let b = -Infinity;
      for (const seg of p.wave.segments)
        for (const pt of seg) {
          lo = Math.min(lo, pt.st);
          hi = Math.max(hi, pt.st);
          a = Math.min(a, pt.t);
          b = Math.max(b, pt.t);
        }
      if (!Number.isFinite(lo)) {
        lo = -4;
        hi = 4;
        a = p.syllables[0]?.start ?? 0;
        b = p.syllables[p.syllables.length - 1]?.end ?? 1;
      }
      const s0 = Math.min(a, p.syllables[0]?.start ?? a);
      const s1 = Math.max(b, p.syllables[p.syllables.length - 1]?.end ?? b);
      t0 = s0 - 0.12;
      t1 = s1 + 0.16;
      lo -= 2.2;
      hi += 2.2;
      if (hi - lo < 10) {
        const add = (10 - (hi - lo)) / 2;
        lo -= add;
        hi += add;
      }
      st0 = lo;
      st1 = hi;
    };

    // ---- view: 0 = whole guide fitted, 1 = following the cursor
    let k = 0;
    let kFrom = 0;
    let kTo = 0;
    let kAt = 0;
    const secPerView = () => Math.min(4, Math.max(1.8, W / 190));

    // ---- grade pops (drawn on the canvas; no DOM per pop)
    const pops: Pop[] = [];
    let seenGrades: (BarGrade | null)[] = [];
    let barsKey: unknown = null;

    let lastSig = "";
    let raf = 0;

    const draw = (now: number) => {
      const p = propsRef.current;
      const live = p.live.current;
      prepare();
      // follow transition
      const target = live.follow && live.t !== null ? 1 : 0;
      if (target !== kTo) {
        kFrom = k;
        kTo = target;
        kAt = now;
      }
      const dur = reduce.matches ? 1 : 420;
      const prog = Math.min(1, (now - kAt) / dur);
      k = kFrom + (kTo - kFrom) * easeInOut(prog);
      const animating = prog < 1;

      const innerW = W - PAD.l - PAD.r;
      const cursor = live.t ?? 0;
      const fitA = PAD.l - (t0 * innerW) / (t1 - t0);
      const fitB = innerW / (t1 - t0);
      const folB = innerW / secPerView();
      const folA = W * NOW_X - cursor * folB;
      const A = fitA + (folA - fitA) * k;
      const B = fitB + (folB - fitB) * k;
      const X = (t: number) => A + B * t;
      const Y = (st: number) => PAD.t + ((st1 - st) / (st1 - st0)) * (H - PAD.t - PAD.b);
      const scale = Math.max(0.85, Math.min(1.7, H / 180));
      const tVis0 = (-A - 20) / B;
      const tVis1 = (W - A + 20) / B;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // staff lines (quiet)
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (let st = Math.ceil(st0 / 2) * 2; st <= st1; st += 2) {
        const y = Math.round(Y(st)) + 0.5;
        if (y < PAD.t - 6 || y > H - PAD.b) continue;
        ctx.beginPath();
        ctx.moveTo(6, y);
        ctx.lineTo(W - 6, y);
        ctx.stroke();
      }

      // ---- the ribbon
      const fills: WaveFill[][] | null = live.bars ? waveFill(p.wave, p.syllables, live.bars) : null;
      const thick = (w: number, bridged: boolean) => (5 + 15 * w) * scale * (bridged ? 0.72 : 1);
      const ribbon = (seg: (typeof p.wave.segments)[number], from: number, to: number, extra: number) => {
        // polygon: upper edge forward, lower edge back, round caps from the stroke-join of the outline
        ctx.beginPath();
        for (let i = from; i <= to; i++) {
          const pt = seg[i];
          ctx.lineTo(X(pt.t), Y(pt.st) - thick(pt.w, !!pt.b) / 2 - extra);
        }
        for (let i = to; i >= from; i--) {
          const pt = seg[i];
          ctx.lineTo(X(pt.t), Y(pt.st) + thick(pt.w, !!pt.b) / 2 + extra);
        }
        ctx.closePath();
        ctx.fill();
      };
      const capR = (pt: { w: number; b?: true }) => thick(pt.w, !!pt.b) / 2;
      const color = (f: WaveFill): string => {
        switch (f) {
          case 5:
            return "rgba(255,244,190,1)";
          case 4:
          case 3:
            return rgba(col.voice, 1);
          case 2:
            return rgba(col.good, 0.9);
          case 1:
            return "rgba(118,124,190,0.55)";
          default:
            return rgba(col.guide, k > 0.5 || live.t !== null ? 0.55 : 0.62);
        }
      };

      p.wave.segments.forEach((seg, si) => {
        if (seg.length < 2) return;
        if (seg[seg.length - 1].t < tVis0 || seg[0].t > tVis1) return;
        // glow
        ctx.fillStyle = rgba(col.guide, 0.1);
        ribbon(seg, 0, seg.length - 1, 5 * scale);
        // body, in runs of one colour (round caps at both ends of the segment)
        const f = fills?.[si];
        let runStart = 0;
        for (let i = 1; i <= seg.length; i++) {
          const cur = f ? f[runStart] : 0;
          if (i < seg.length && (f ? f[i] : 0) === cur) continue;
          const end = Math.min(seg.length - 1, i); // overlap one point so runs meet without a seam
          ctx.fillStyle = color(cur as WaveFill);
          ribbon(seg, runStart, end, 0);
          if (cur === 4) {
            ctx.fillStyle = rgba(col.hit, 0.28);
            ribbon(seg, runStart, end, 3 * scale);
            ctx.fillStyle = rgba(col.voice, 1);
            ribbon(seg, runStart, end, 0);
          }
          runStart = i;
        }
        const first = seg[0];
        const last = seg[seg.length - 1];
        ctx.fillStyle = color((f ? f[0] : 0) as WaveFill);
        ctx.beginPath();
        ctx.arc(X(first.t), Y(first.st), capR(first), Math.PI / 2, (Math.PI * 3) / 2);
        ctx.fill();
        ctx.fillStyle = color((f ? f[seg.length - 1] : 0) as WaveFill);
        ctx.beginPath();
        ctx.arc(X(last.t), Y(last.st), capR(last), -Math.PI / 2, Math.PI / 2);
        ctx.fill();
        // gloss along the top
        ctx.strokeStyle = "rgba(255,255,255,0.32)";
        ctx.lineWidth = Math.max(1.5, 2.2 * scale);
        ctx.beginPath();
        for (let i = 0; i < seg.length; i++) {
          const pt = seg[i];
          if (pt.b) {
            ctx.moveTo(X(pt.t), Y(pt.st) - thick(pt.w, true) * 0.22);
            continue;
          }
          ctx.lineTo(X(pt.t), Y(pt.st) - thick(pt.w, false) * 0.22);
        }
        ctx.stroke();
      });

      // ---- a line (yours): navy halo, white core
      const line = (pts: readonly { t: number; st: number | null }[], upTo: number | null, width: number) => {
        const path = () => {
          ctx.beginPath();
          let pen = false;
          let prevSt: number | null = null;
          for (let i = 0; i < pts.length; i++) {
            const pt = pts[i];
            if (upTo !== null && pt.t > upTo) break;
            // pitch-tracker spikes (octave jumps on a final consonant) break the line instead of drawing a needle
            const spike = pt.st !== null && prevSt !== null && Math.abs(pt.st - prevSt) > 7;
            prevSt = pt.st;
            if (pt.st === null || spike || pt.t < tVis0 || pt.t > tVis1) {
              pen = false;
              continue;
            }
            const x = X(pt.t);
            const y = Math.min(H - PAD.b + 6, Math.max(PAD.t - 12, Y(pt.st)));
            if (pen) ctx.lineTo(x, y);
            else {
              ctx.moveTo(x, y);
              pen = true;
            }
          }
        };
        path();
        ctx.strokeStyle = rgba(col.monitor, 0.92);
        ctx.lineWidth = width + 4 * scale;
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = width;
        ctx.stroke();
      };
      if (p.overlay && p.overlay.length) line(p.overlay, p.progressive ? live.t ?? -1 : null, 2.6 * scale);
      else if (live.line.length) {
        line(live.line, null, 2.6 * scale);
        // head of the live line
        for (let i = live.line.length - 1; i >= 0; i--) {
          const pt = live.line[i];
          if (pt.st === null) continue;
          if (live.t !== null && live.follow && live.t - pt.t < 0.15) {
            const x = X(pt.t);
            const y = Math.min(H - PAD.b + 6, Math.max(PAD.t - 12, Y(pt.st)));
            ctx.fillStyle = "rgba(255,255,255,0.25)";
            ctx.beginPath();
            ctx.arc(x, y, 9 * scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(x, y, 4 * scale, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
      }

      // ---- focus on one word
      if (p.focusWord != null && p.words[p.focusWord]) {
        const w = p.words[p.focusWord];
        const a = X(w.start) - 6;
        const b = X(w.end) + 6;
        ctx.fillStyle = rgba(col.monitor, 0.72);
        ctx.fillRect(0, 0, Math.max(0, a), H - PAD.b + 4);
        ctx.fillRect(b, 0, Math.max(0, W - b), H - PAD.b + 4);
      }

      // ---- the cursor / now line
      if (live.t !== null) {
        const x = X(live.t);
        const tone = live.tone === "voice" ? col.voice : col.guide;
        ctx.strokeStyle = live.follow ? "rgba(255,255,255,0.6)" : rgba(tone, 0.95);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, PAD.t - 16);
        ctx.lineTo(x, H - PAD.b + 2);
        ctx.stroke();
        ctx.fillStyle = live.follow ? "#fff" : rgba(tone, 1);
        ctx.beginPath();
        ctx.moveTo(x - 6, PAD.t - 20);
        ctx.lineTo(x + 6, PAD.t - 20);
        ctx.lineTo(x, PAD.t - 12);
        ctx.closePath();
        ctx.fill();
      }

      // ---- grade pops + combo
      const bars = live.bars;
      if (bars !== barsKey) {
        barsKey = bars;
        seenGrades = bars ? bars.map((b) => b.grade) : [];
        pops.length = 0;
      }
      let combo = 0;
      if (bars) {
        for (let i = 0; i < bars.length; i++) {
          const g = bars[i].grade;
          if (g && seenGrades[i] !== g) {
            seenGrades[i] = g;
            if (g !== "miss" && live.follow) pops.push({ i, grade: g, at: now });
          }
        }
        for (let i = bars.length - 1; i >= 0; i--) {
          const g = bars[i].grade;
          if (!g) continue;
          if (g === "perfect" || g === "great") combo++;
          else break;
        }
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      for (let n = pops.length - 1; n >= 0; n--) {
        const pop = pops[n];
        const age = (now - pop.at) / POP_MS;
        if (age >= 1) {
          pops.splice(n, 1);
          continue;
        }
        const s = p.syllables[pop.i];
        const tc = (s.start + s.end) / 2;
        const y0 = Y(s.pitchSt ?? 0) - 18 * scale;
        const rise = reduce.matches ? 0 : 16 * scale * age;
        const alpha = age < 0.75 ? 1 : 1 - (age - 0.75) / 0.25;
        const size = Math.round((age < 0.12 && !reduce.matches ? 0.8 + age * 1.6 : 1) * 15 * scale);
        ctx.font = `900 ${size}px ${font}`;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 5;
        ctx.strokeStyle = rgba(col.monitor, 1);
        const label = POP_LABEL[pop.grade];
        const x = X(tc);
        const y = Math.max(PAD.t, y0 - rise);
        ctx.strokeText(label, x, y);
        ctx.fillStyle = pop.grade === "perfect" ? rgba(col.hit, 1) : pop.grade === "great" ? rgba(col.great, 1) : rgba(col.good, 1);
        ctx.fillText(label, x, y);
        ctx.globalAlpha = 1;
      }
      if (combo >= 2 && live.follow) {
        const label = `${combo}コンボ`;
        ctx.font = `900 ${Math.round(13 * scale)}px ${font}`;
        const tw = ctx.measureText(label).width;
        const bx = W - 12 - tw - 20;
        ctx.fillStyle = rgba(col.hit, 1);
        ctx.beginPath();
        ctx.roundRect(bx, 8, tw + 20, 22 * Math.min(scale, 1.2), 11);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "left";
        ctx.fillText(label, bx + 10, 8 + 16 * Math.min(scale, 1.2));
      }

      // ---- word labels
      ctx.textAlign = "left";
      ctx.font = `800 ${Math.round(12 * Math.min(scale, 1.35))}px ${font}`;
      let labelEnd = -Infinity;
      for (let i = 0; i < p.words.length; i++) {
        const w = p.words[i];
        const x = Math.max(4, X(w.start) + 2, labelEnd + 8); // never overlap the previous label
        const tw = ctx.measureText(w.text).width;
        labelEnd = x + tw;
        if (x > W || X(w.end) < 0) continue;
        ctx.fillStyle = p.focusWord == null ? col.muted : p.focusWord === i ? "#ffffff" : "rgba(168,172,217,0.4)";
        ctx.fillText(w.text, x, H - 10);
      }

      return animating || pops.length > 0;
    };

    let busy = false;
    const loop = (now: number) => {
      const p = propsRef.current;
      const live = p.live.current;
      let fs = 0;
      const bars = live.bars;
      if (bars) for (let i = 0; i < bars.length; i++) fs += bars[i].fill * (i + 1) + (bars[i].grade ? 3 * (i + 1) : 0);
      const sig = `${versionRef.current}|${live.version}|${live.t}|${live.follow}|${live.line.length}|${fs.toFixed(3)}|${W}x${H}`;
      if (W > 0 && H > 0 && (dirty || busy || sig !== lastSig)) {
        dirty = false;
        lastSig = sig;
        busy = draw(now);
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
    <div ref={wrapRef} className={props.className ?? "relative h-[200px]"}>
      <canvas ref={canvasRef} role="img" aria-label={props.label} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

/** memoised: the practice screen re-renders on every phase change, the WaveGuide only when its props change */
export default memo(WaveGuide);
