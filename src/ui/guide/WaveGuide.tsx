"use client";

/**
 * The guide as a wave — honest karaoke.
 *   - The band is exactly ±tolSt semitones thick (KaraokeJudge's pitch tolerance), so "your line
 *     overlaps the band" means "the judge counts it". Loudness (w) is drawn as glow, not thickness.
 *   - Your line is gold where it is inside the band (judge.line[i].inBand) and thin white outside,
 *     with a small 高い / 低い mark at its head while you are off.
 *   - A syllable lights up and pops GREAT / PERFECT only once the judge has finalized it (one pop
 *     at a time); a late syllable gets a small おそい. Sung parts fade as they scroll away.
 *   - After the take: the model's band, your line over it, and the stretches where you were off
 *     shaded lightly.
 * One canvas, one requestAnimationFrame loop, inputs from refs, no React state per frame.
 */
import { memo, useEffect, useRef } from "react";
import type { BarGrade } from "@/engine/karaoke/judge.ts";
import type { GuideProps } from "./types";

const PAD = { l: 12, r: 12, t: 22, b: 34 };
const NOW_X = 0.3;

type RGB = [number, number, number];
const rgb = (hex: string, fb: RGB): RGB => {
  const h = hex.trim().replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return Number.isFinite(n) && h.length >= 3 ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : fb;
};
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

type Pop = { i: number; text: string; late: boolean; at: number };
const POP_MS = 900;

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
      miss: rgb(cs.getPropertyValue("--miss"), [214, 36, 95]),
      monitor: rgb(cs.getPropertyValue("--monitor"), [12, 15, 51]),
      muted: cs.getPropertyValue("--monitor-muted").trim() || "#a8acd9",
    };
    let font = cs.fontFamily;
    let latin = getComputedStyle(document.documentElement).getPropertyValue("--font-latin") || "";
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
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      dirty = true;
    };
    const ro = new ResizeObserver((entries) => resize(entries[0].contentRect));
    ro.observe(wrap);
    resize(wrap.getBoundingClientRect());
    document.fonts?.ready.then(() => {
      font = getComputedStyle(wrap).fontFamily;
      latin = getComputedStyle(wrap).getPropertyValue("--font-latin") || latin;
      dirty = true;
    });

    // ---- per-wave geometry
    let geomKey: unknown = null;
    let t0 = 0;
    let t1 = 1;
    let st0 = -8;
    let st1 = 8;
    const prepare = () => {
      const p = propsRef.current;
      if (geomKey === p.wave) return;
      geomKey = p.wave;
      const tol = p.tolSt ?? 2.5;
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
      t0 = Math.min(a, p.syllables[0]?.start ?? a) - 0.12;
      t1 = Math.max(b, p.syllables[p.syllables.length - 1]?.end ?? b) + 0.16;
      // room for the band's own thickness and a little air; never so tight that the band swallows the lane
      lo -= tol + 1.5;
      hi += tol + 1.5;
      if (hi - lo < 16) {
        const add = (16 - (hi - lo)) / 2;
        lo -= add;
        hi += add;
      }
      st0 = lo;
      st1 = hi;
    };

    let k = 0;
    let kFrom = 0;
    let kTo = 0;
    let kAt = 0;
    const secPerView = () => Math.min(4, Math.max(1.8, W / 190));

    const pops: Pop[] = [];
    let seenGrades: (BarGrade | null)[] = [];
    let barsKey: unknown = null;
    let lastSig = "";
    let raf = 0;

    const draw = (now: number) => {
      const p = propsRef.current;
      const live = p.live.current;
      prepare();
      const target = live.follow && live.t !== null ? 1 : 0;
      if (target !== kTo) {
        kFrom = k;
        kTo = target;
        kAt = now;
      }
      const prog = Math.min(1, (now - kAt) / (reduce.matches ? 1 : 420));
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
      const pxPerSt = (H - PAD.t - PAD.b) / (st1 - st0);
      const Y = (st: number) => PAD.t + (st1 - st) * pxPerSt;
      const tol = p.tolSt ?? 2.5;
      const band = 2 * tol * pxPerSt; // the hit zone, in pixels
      const scale = Math.max(0.85, Math.min(1.7, H / 180));
      const tVis0 = (-A - 20) / B;
      const tVis1 = (W - A + 20) / B;
      const settled = !!(p.overlay && p.overlay.length);
      // sung parts fade as they scroll away (follow mode only)
      const fade = (t: number) => (live.follow && live.t !== null ? Math.max(0.25, Math.min(1, 1 - (live.t - 0.35 - t) / 1.2)) : 1);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // after the take: where you were off, shaded lightly behind everything
      if (settled && p.offStretches) {
        ctx.fillStyle = rgba(col.miss, 0.2);
        for (const r of p.offStretches) {
          const x0 = X(r.start);
          const x1 = X(r.end);
          if (x1 > x0) ctx.fillRect(x0, PAD.t - 8, x1 - x0, H - PAD.t - PAD.b + 10);
        }
      }

      // ---- the band: constant thickness (= tolerance), glow from loudness, lit once a syllable is won
      const bars = live.bars;
      const sylOf = (t: number) => {
        for (let i = 0; i < p.syllables.length; i++) if (t >= p.syllables[i].start && t <= p.syllables[i].end) return i;
        return -1;
      };
      for (const seg of p.wave.segments) {
        if (seg.length < 2 || seg[seg.length - 1].t < tVis0 || seg[0].t > tVis1) continue;
        // the band is ±tol semitones around the melody, measured vertically (pitch is vertical):
        // one ribbon polygon per segment, shaded along its length by a gradient (loudness, "won")
        const style = (i: number) => {
          const pt = seg[i];
          const si = sylOf(pt.t);
          const g = si >= 0 && bars ? bars[si]?.grade : null;
          const won = !settled && (g === "great" || g === "perfect");
          const glow = (0.32 + 0.5 * pt.w) * (pt.b ? 0.6 : 1) * fade(pt.t);
          return { fill: won ? rgba(col.guide, Math.min(1, glow + 0.4 * fade(pt.t))) : rgba(col.guide, glow * (settled ? 0.75 : 0.85)) };
        };
        const xa = X(seg[0].t);
        const xb = X(seg[seg.length - 1].t);
        const grad = ctx.createLinearGradient(xa, 0, Math.max(xa + 1, xb), 0);
        const step = Math.max(1, Math.floor(seg.length / 90)); // ≤ ~90 stops per segment
        for (let i = 0; i < seg.length; i += step) grad.addColorStop(Math.min(1, Math.max(0, (X(seg[i].t) - xa) / Math.max(1, xb - xa))), style(i).fill);
        grad.addColorStop(1, style(seg.length - 1).fill);
        ctx.fillStyle = grad;
        ctx.beginPath();
        for (let i = 0; i < seg.length; i++) {
          const x = X(seg[i].t);
          const y = Y(seg[i].st) - band / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let i = seg.length - 1; i >= 0; i--) ctx.lineTo(X(seg[i].t), Y(seg[i].st) + band / 2);
        ctx.closePath();
        ctx.fill();
        // rounded ends (outward half-discs)
        for (const [pt, a0, a1] of [
          [seg[0], Math.PI / 2, (Math.PI * 3) / 2],
          [seg[seg.length - 1], -Math.PI / 2, Math.PI / 2],
        ] as const) {
          ctx.fillStyle = style(pt === seg[0] ? 0 : seg.length - 1).fill;
          ctx.beginPath();
          ctx.ellipse(X(pt.t), Y(pt.st), Math.min(band / 2, 12), band / 2, 0, a0, a1);
          ctx.fill();
        }
        // a thin bright centre line: the model's melody itself
        ctx.strokeStyle = rgba(col.guide, settled ? 0.9 : 1);
        ctx.lineWidth = Math.max(1.5, 2 * scale);
        ctx.beginPath();
        seg.forEach((pt, i) => (i ? ctx.lineTo(X(pt.t), Y(pt.st)) : ctx.moveTo(X(pt.t), Y(pt.st))));
        ctx.stroke();
      }

      // ---- the cursor / now line
      if (live.t !== null) {
        const x = X(live.t);
        const tone = live.tone === "voice" ? col.voice : col.guide;
        ctx.strokeStyle = live.follow ? "rgba(255,255,255,0.55)" : rgba(tone, 0.95);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, PAD.t - 16);
        ctx.lineTo(x, H - PAD.b + 2);
        ctx.stroke();
      }

      // ---- your line: gold inside the band, thin white outside
      const pts = settled ? smoothLine(p.overlay!) : live.line;
      const upTo = settled ? (p.progressive ? Math.min(live.t ?? -1, (p.syllables[p.syllables.length - 1]?.end ?? 1e9) + 0.08) : (p.syllables[p.syllables.length - 1]?.end ?? 1e9) + 0.08) : null;
      let prevSt: number | null = null;
      let prevPt: { x: number; y: number; t: number; inBand: boolean } | null = null;
      let head: { x: number; y: number; st: number; t: number; inBand: boolean; run: number } | null = null;
      let run = 0; // points in the current unbroken stretch
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i] as { t: number; st: number | null; inBand?: boolean };
        if (upTo !== null && pt.t > upTo) break;
        const spike = pt.st !== null && prevSt !== null && Math.abs(pt.st - prevSt) > 6;
        prevSt = pt.st;
        if (pt.st === null || spike || pt.t < tVis0 || pt.t > tVis1) {
          if (!settled || (prevPt && pts[i + 1] && (pts[i + 1] as { st: number | null }).st === null)) prevPt = null;
          continue;
        }
        const inBand = settled ? Math.abs(pt.st - guideAt(p.wave, pt.t)) <= tol : !!pt.inBand;
        const cur = { x: X(pt.t), y: Math.min(H - PAD.b + 6, Math.max(PAD.t - 14, Y(pt.st))), t: pt.t, inBand };
        const joined = !!prevPt && cur.t - prevPt.t < (settled ? 0.25 : 0.06);
        run = joined ? run + 1 : 1;
        // live: a stretch shows from its third point (a stub of one or two frames would be a speck)
        if (prevPt && joined && (settled || run >= 3)) {
          const a = fade(cur.t);
          if (cur.inBand) {
            ctx.strokeStyle = rgba(col.voice, 0.28 * a);
            ctx.lineWidth = 9 * scale;
            ctx.beginPath();
            ctx.moveTo(prevPt.x, prevPt.y);
            ctx.lineTo(cur.x, cur.y);
            ctx.stroke();
          }
          ctx.strokeStyle = cur.inBand ? rgba(col.voice, a) : `rgba(255,255,255,${0.85 * a})`;
          ctx.lineWidth = (cur.inBand ? 3.6 : 1.8) * scale;
          ctx.beginPath();
          ctx.moveTo(prevPt.x, prevPt.y);
          ctx.lineTo(cur.x, cur.y);
          ctx.stroke();
        }
        prevPt = cur;
        head = { ...cur, st: pt.st, run };
      }
      // the head while singing: a dot, and 高い / 低い when you are off
      // (only at the end of a drawn stretch: a lone point or two after a jump would float)
      if (!settled && head && head.run >= 4 && live.t !== null && live.follow && live.t - head.t < 0.18) {
        ctx.fillStyle = head.inBand ? rgba(col.voice, 1) : "#ffffff";
        ctx.beginPath();
        ctx.arc(head.x, head.y, 4.5 * scale, 0, Math.PI * 2);
        ctx.fill();
        if (!head.inBand) {
          const g = guideAt(p.wave, head.t);
          if (Number.isFinite(g)) {
            const high = head.st > g;
            ctx.font = `600 ${Math.round(11 * scale)}px ${font}`;
            ctx.textAlign = "left";
            ctx.fillStyle = "#ffffff";
            ctx.fillText(high ? "▲ 高い" : "▼ 低い", head.x + 9, head.y + (high ? -6 : 14));
          }
        }
      }

      // ---- pops: finalized GREAT+ only, one at a time; おそい when the syllable came late
      if (bars !== barsKey) {
        barsKey = bars;
        seenGrades = bars ? bars.map((b) => b.grade) : [];
        pops.length = 0;
      }
      if (bars) {
        for (let i = 0; i < bars.length; i++) {
          const g = bars[i].grade;
          if (g && seenGrades[i] !== g) {
            seenGrades[i] = g;
            if (!live.follow) continue;
            const late = bars[i].timing === "late";
            if (g === "great" || g === "perfect" || late) {
              pops.length = 0; // never two at once
              pops.push({ i, text: g === "perfect" ? "PERFECT" : g === "great" ? "GREAT" : "", late, at: now });
            }
          }
        }
      }
      ctx.textAlign = "center";
      for (let n = pops.length - 1; n >= 0; n--) {
        const pop = pops[n];
        const age = (now - pop.at) / POP_MS;
        if (age >= 1) {
          pops.splice(n, 1);
          continue;
        }
        const s = p.syllables[pop.i];
        const alpha = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3;
        const rise = reduce.matches ? 0 : 12 * scale * age;
        const y = Math.max(PAD.t + 4, Y(s.pitchSt ?? 0) - band / 2 - 8 - rise);
        ctx.globalAlpha = alpha;
        if (pop.text) {
          ctx.font = `800 ${Math.round(16 * scale)}px ${latin || font}`;
          const half = ctx.measureText(pop.text).width / 2 + 6;
          const x = Math.min(W - half, Math.max(half, X((s.start + s.end) / 2)));
          ctx.lineWidth = 5;
          ctx.strokeStyle = rgba(col.monitor, 1);
          ctx.strokeText(pop.text, x, y);
          ctx.fillStyle = rgba(col.voice, 1);
          ctx.fillText(pop.text, x, y);
        }
        if (pop.late) {
          ctx.font = `600 ${Math.round(11 * scale)}px ${font}`;
          const x = Math.min(W - 24, Math.max(24, X((s.start + s.end) / 2)));
          ctx.fillStyle = "#ffffff";
          ctx.fillText("おそい", x, y + (pop.text ? 16 * scale : 0));
        }
        ctx.globalAlpha = 1;
      }

      // ---- labels: word names centred under their own wave; the two lines named directly
      ctx.textAlign = "center";
      ctx.font = `700 ${Math.round(12 * Math.min(scale, 1.35))}px ${latin || font}`;
      let labelEnd = -Infinity;
      for (let i = 0; i < p.words.length; i++) {
        const w = p.words[i];
        const tw = ctx.measureText(w.text).width;
        const cx = Math.max(X((w.start + w.end) / 2), labelEnd + 6 + tw / 2);
        labelEnd = cx + tw / 2;
        if (cx - tw / 2 > W || cx + tw / 2 < 0) continue;
        ctx.fillStyle = p.focusWord == null ? col.muted : p.focusWord === i ? "#ffffff" : "rgba(168,172,217,0.4)";
        ctx.globalAlpha = fade(w.end);
        ctx.fillText(w.text, cx, H - 12);
        ctx.globalAlpha = 1;
      }
      // direct labels (no legend): お手本 at the start of the band, あなた next to your line
      const first = p.wave.segments[0]?.[0];
      if (first && !live.follow) {
        ctx.textAlign = "left";
        ctx.font = `600 ${Math.round(11 * Math.min(scale, 1.3))}px ${font}`;
        ctx.fillStyle = rgba(col.guide, 1);
        ctx.fillText("お手本", Math.max(4, X(first.t) - 4), Math.max(12, Y(first.st) - band / 2 - 6));
      }
      if (settled && head) {
        ctx.textAlign = "left";
        ctx.font = `600 ${Math.round(11 * Math.min(scale, 1.3))}px ${font}`;
        ctx.fillStyle = rgba(col.voice, 1);
        ctx.fillText("あなた", Math.min(W - 40, head.x + 8), Math.min(H - PAD.b - 2, head.y + 4));
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

/** the model's pitch at t (nearest wave point within 40 ms), NaN if none */
function guideAt(wave: GuideProps["wave"], t: number): number {
  let best = NaN;
  let d = 0.04;
  for (const seg of wave.segments) {
    if (seg.length === 0 || t < seg[0].t - 0.04 || t > seg[seg.length - 1].t + 0.04) continue;
    for (const pt of seg) {
      const dd = Math.abs(pt.t - t);
      if (dd < d) {
        d = dd;
        best = pt.st;
      }
    }
  }
  return best;
}

/** after the take: a light 5-point moving average so the line reads as a melody, not jitter */
function smoothLine(pts: readonly { t: number; st: number | null }[]): { t: number; st: number | null }[] {
  return pts.map((p, i) => {
    if (p.st === null) return p;
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(pts.length - 1, i + 2); k++) {
      const q = pts[k].st;
      if (q === null || Math.abs(q - p.st) > 4) continue;
      s += q;
      n++;
    }
    return { t: p.t, st: n ? s / n : p.st };
  });
}

/**
 * After the take: the guide-time stretches where your (smoothed) line was outside the band for at
 * least `minS` — what the chart shades. Gaps under 120 ms inside a stretch don't split it.
 */
export function offStretches(pts: readonly { t: number; st: number | null }[] | null, wave: GuideProps["wave"], tolSt: number, minS = 0.15): { start: number; end: number }[] {
  if (!pts || !pts.length) return [];
  const out: { start: number; end: number }[] = [];
  let cur: { start: number; end: number } | null = null;
  for (const p of smoothLine(pts)) {
    if (p.st === null) continue;
    const g = guideAt(wave, p.t);
    if (!Number.isFinite(g)) continue;
    const off = Math.abs(p.st - g) > tolSt;
    if (off) {
      if (cur && p.t - cur.end <= 0.12) cur.end = p.t;
      else {
        if (cur && cur.end - cur.start >= minS) out.push(cur);
        cur = { start: p.t, end: p.t };
      }
    } else if (cur && p.t - cur.end > 0.12) {
      if (cur.end - cur.start >= minS) out.push(cur);
      cur = null;
    }
  }
  if (cur && cur.end - cur.start >= minS) out.push(cur);
  return out;
}

/** memoised: the practice screen re-renders on every phase change, the WaveGuide only when its props change */
export default memo(WaveGuide);
