"use client";

/**
 * The guide as a wave — honest karaoke, with your voice as the hero.
 *   - お手本 is one quiet band, exactly ±tolSt semitones thick (the judge's tolerance), so "your
 *     line overlaps the band" means "the judge counts it".
 *   - Your line: median-filtered and drawn as a smooth curve, 3–4 pt, glowing — gold inside the
 *     band (judge.line[i].inBand), white outside. Its pen tip is held at the playhead (the pitch
 *     tracker runs a few frames behind; the tip is drawn on to the cursor while you are voicing).
 *   - When a word is fully judged, PERFECT / GREAT / もう一歩 pops right above that word — never
 *     over the cursor or the edges. A late word gets a small おそい.
 *   - A small bracket under each word with its name; the word under the cursor bright, the rest dim.
 *     The pitch range is fitted to the sentence; the left and right edges fade out.
 *   - After the take: the band, your line over it, the stretches where you were off shaded lightly.
 * One canvas, one requestAnimationFrame loop, inputs from refs, no React state per frame.
 */
import { memo, useEffect, useRef } from "react";
import type { GuideProps } from "./types";
import { WORD_GRADE_LABEL, wordGrade, type WordGrade } from "./grades";

const PAD = { l: 12, r: 12, t: 34, b: 18 };
const NOW_X = 0.5; // the word being sung stays in the middle of the card
const EDGE = 32; // px of fade at the left and right edges (also keeps words clear of the rounded corners)

type RGB = [number, number, number];
const rgb = (hex: string, fb: RGB): RGB => {
  const h = hex.trim().replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return Number.isFinite(n) && h.length >= 3 ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : fb;
};
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

type Pop = { word: number; grade: WordGrade; late: boolean; at: number; x0: number; x1: number };
const POP_MS = 1000;
type SmPt = { t: number; st: number | null; inBand: boolean };

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
      muted: rgb(cs.getPropertyValue("--monitor-muted"), [168, 172, 217]),
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

    // ---- per-wave geometry: the time span, and a pitch range fitted to this sentence
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
      // the band's own thickness and a little air above and below; a flat line still gets some room
      lo -= tol + 1;
      hi += tol + 1;
      // at least 28 semitones tall: the ±tol band is ~18 % of the height, so the rises and falls read
      if (hi - lo < 28) {
        const add = (28 - (hi - lo)) / 2;
        lo -= add;
        hi += add;
      }
      st0 = lo;
      st1 = hi;
    };

    // ---- your live line, smoothed once per new point (a causal 5-point median within a run)
    let smKey: unknown = null;
    let sm: SmPt[] = [];
    let run: number[] = [];
    let lastT = -1;
    const smoothLive = (line: readonly { t: number; st: number | null; inBand?: boolean }[]) => {
      if (line !== smKey || line.length < sm.length) {
        smKey = line;
        sm = [];
        run = [];
        lastT = -1;
      }
      for (let i = sm.length; i < line.length; i++) {
        const q = line[i];
        if (q.st === null || q.t - lastT > 0.06) run = [];
        if (q.st === null) {
          sm.push({ t: q.t, st: null, inBand: false });
          continue;
        }
        // an octave slip is not a melody: drop a point far from where the run has been
        const ref = run.length ? median(run) : q.st;
        if (run.length >= 3 && Math.abs(q.st - ref) > 6) {
          sm.push({ t: q.t, st: null, inBand: false });
          continue;
        }
        run.push(q.st);
        if (run.length > 5) run.shift();
        sm.push({ t: q.t, st: median(run), inBand: !!q.inBand });
        lastT = q.t;
      }
      return sm;
    };

    let k = 0;
    let kFrom = 0;
    let kTo = 0;
    let kAt = 0;
    const secPerView = () => Math.min(4, Math.max(1.8, W / 190));

    const pops: Pop[] = [];
    let popped: boolean[] = [];
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
      const clampY = (y: number) => Math.min(H - PAD.b + 4, Math.max(PAD.t - 12, y));
      const tol = p.tolSt ?? 2.5;
      const band = 2 * tol * pxPerSt; // the hit zone, in pixels
      const scale = Math.max(0.85, Math.min(1.6, H / 190));
      const tVis0 = (-A - 20) / B;
      const tVis1 = (W - A + 20) / B;
      const settled = !!(p.overlay && p.overlay.length);
      const following = live.follow && live.t !== null;
      // sung parts fade as they scroll away (follow mode only)
      const fade = (t: number) => (following ? Math.max(0.35, Math.min(1, 1 - (cursor - 0.35 - t) / 1.4)) : 1);
      const bars = live.bars;

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

      // ---- お手本: a bright thin core (the melody) in a faint halo exactly as wide as the tolerance
      const sylOf = (t: number) => {
        for (let i = 0; i < p.syllables.length; i++) if (t >= p.syllables[i].start && t <= p.syllables[i].end) return i;
        return -1;
      };
      // all segments in ONE path (no seams where they meet), lightly smoothed (±3 points);
      // painted twice: a faint halo exactly as wide as the tolerance, then a bright thin core
      const melody = new Path2D();
      let any = false;
      for (const seg of p.wave.segments) {
        if (seg.length < 2 || seg[seg.length - 1].t < tVis0 - 0.5 || seg[0].t > tVis1 + 0.5) continue;
        const ys = seg.map((_, i) => {
          let sum = 0;
          let n = 0;
          for (let k = Math.max(0, i - 3); k <= Math.min(seg.length - 1, i + 3); k++) {
            sum += seg[k].st;
            n++;
          }
          return Y(sum / n);
        });
        melody.moveTo(X(seg[0].t), ys[0]);
        for (let i = 1; i < seg.length - 1; i++) melody.quadraticCurveTo(X(seg[i].t), ys[i], (X(seg[i].t) + X(seg[i + 1].t)) / 2, (ys[i] + ys[i + 1]) / 2);
        melody.lineTo(X(seg[seg.length - 1].t), ys[seg.length - 1]);
        any = true;
      }
      if (any) {
        // one gradient across the view: sung parts fade as they scroll away; a won syllable a little brighter
        const xa = Math.max(0, X(tVis0));
        const xb = Math.min(W, X(tVis1));
        const halo = ctx.createLinearGradient(xa, 0, Math.max(xa + 1, xb), 0);
        const core = ctx.createLinearGradient(xa, 0, Math.max(xa + 1, xb), 0);
        for (let k = 0; k <= 24; k++) {
          const t = tVis0 + ((tVis1 - tVis0) * k) / 24;
          const si = sylOf(t);
          const g = si >= 0 && bars ? bars[si]?.grade : null;
          const won = !settled && (g === "great" || g === "perfect");
          const f = fade(t);
          halo.addColorStop(k / 24, rgba(col.guide, (won ? 0.26 : 0.16) * f));
          core.addColorStop(k / 24, rgba(col.guide, (won ? 1 : 0.92) * f));
        }
        ctx.strokeStyle = halo;
        ctx.lineWidth = band;
        ctx.stroke(melody);
        ctx.strokeStyle = core;
        ctx.lineWidth = Math.max(2, 2.4 * scale);
        ctx.stroke(melody);
      }

      // ---- the playhead (under your line, so the pen tip sits on it)
      if (live.t !== null) {
        const x = X(live.t);
        const tone = live.tone === "voice" ? col.voice : col.guide;
        ctx.strokeStyle = following ? "rgba(255,255,255,0.4)" : rgba(tone, 0.95);
        ctx.lineWidth = following ? 1.5 : 2;
        ctx.beginPath();
        ctx.moveTo(x, PAD.t - 18);
        ctx.lineTo(x, H - PAD.b + 2);
        ctx.stroke();
      }

      // ---- your line: smooth, glowing; gold inside the band, white outside
      const pts: readonly SmPt[] = settled ? smoothLine(p.overlay!).map((q) => ({ t: q.t, st: q.st, inBand: q.st !== null && Math.abs(q.st - guideAt(p.wave, q.t)) <= tol })) : smoothLive(live.line);
      const upTo = settled ? (p.progressive ? Math.min(live.t ?? -1, (p.syllables[p.syllables.length - 1]?.end ?? 1e9) + 0.08) : (p.syllables[p.syllables.length - 1]?.end ?? 1e9) + 0.08) : null;
      // short unvoiced stretches (consonants) are bridged so the line reads as one phrase
      const gap = settled ? 0.25 : 0.16;
      let tip: { x: number; y: number; t: number; st: number; inBand: boolean } | null = null;
      // a run = consecutive voiced points; drawn as quadratic curves through the midpoints, one path per colour
      let runPts: { x: number; y: number; t: number; inBand: boolean; st: number }[] = [];
      const flush = () => {
        const n = runPts.length;
        // a stretch of one or two frames is not drawn (a speck), and it does not move the pen tip
        if (n >= (settled ? 2 : 3)) {
          strokeRun(runPts);
          const l = runPts[n - 1];
          tip = { x: l.x, y: l.y, t: l.t, st: l.st, inBand: l.inBand };
        }
        runPts = [];
      };
      const strokeRun = (r: typeof runPts) => {
        let i0 = 0;
        while (i0 < r.length - 1) {
          const inBand = r[i0 + 1].inBand;
          let i1 = i0 + 1;
          while (i1 < r.length - 1 && r[i1 + 1].inBand === inBand) i1++;
          // path from the midpoint before i0+1 … to the midpoint after i1 (or the run's ends)
          const a = fade(r[i1].t);
          ctx.beginPath();
          const sx = i0 === 0 ? r[0].x : (r[i0].x + r[i0 + 1].x) / 2;
          const sy = i0 === 0 ? r[0].y : (r[i0].y + r[i0 + 1].y) / 2;
          ctx.moveTo(sx, sy);
          for (let i = i0 + 1; i <= i1; i++) {
            const last = i === r.length - 1;
            const mx = last ? r[i].x : (r[i].x + r[i + 1].x) / 2;
            const my = last ? r[i].y : (r[i].y + r[i + 1].y) / 2;
            ctx.quadraticCurveTo(r[i].x, r[i].y, mx, my);
          }
          // glow, then the line
          ctx.strokeStyle = inBand ? rgba(col.voice, 0.3 * a) : `rgba(255,255,255,${0.14 * a})`;
          ctx.lineWidth = (inBand ? 11 : 8) * scale;
          ctx.stroke();
          ctx.strokeStyle = inBand ? rgba(col.voice, a) : `rgba(255,255,255,${0.92 * a})`;
          ctx.lineWidth = (inBand ? 3.8 : 3) * scale;
          ctx.stroke();
          i0 = i1;
        }
      };
      let prevT = -1;
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        if (upTo !== null && q.t > upTo) break;
        if (q.t < tVis0 - 0.3) continue;
        if (q.st === null) continue; // unvoiced: bridged if the voice comes back soon
        if (q.t - prevT > gap) flush();
        if (q.t > tVis1) break;
        runPts.push({ x: X(q.t), y: clampY(Y(q.st)), t: q.t, inBand: q.inBand, st: q.st });
        prevT = q.t;
      }
      flush();
      // the pen tip, held at the playhead while you are voicing (the pitch arrives a few frames late)
      const tp = tip as { x: number; y: number; t: number; st: number; inBand: boolean } | null;
      if (!settled && following && tp && cursor - tp.t < 0.22) {
        const cx = X(cursor);
        if (cx > tp.x + 0.5) {
          ctx.strokeStyle = tp.inBand ? rgba(col.voice, 1) : "rgba(255,255,255,0.92)";
          ctx.lineWidth = (tp.inBand ? 3.8 : 3) * scale;
          ctx.beginPath();
          ctx.moveTo(tp.x, tp.y);
          ctx.lineTo(cx, tp.y);
          ctx.stroke();
        }
        ctx.fillStyle = tp.inBand ? rgba(col.voice, 1) : "#ffffff";
        ctx.shadowColor = tp.inBand ? rgba(col.voice, 0.9) : "rgba(255,255,255,0.7)";
        ctx.shadowBlur = 10 * scale;
        ctx.beginPath();
        ctx.arc(Math.max(cx, tp.x), tp.y, 5 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // one cue at a time: while a word's judgement is up, no 高い / 低い
        const popUp = pops.length > 0 && now - pops[0].at < POP_MS;
        if (!tp.inBand && !popUp) {
          const g = guideAt(p.wave, cursor);
          if (Number.isFinite(g)) {
            const high = tp.st > g;
            ctx.font = `600 ${Math.round(12 * scale)}px ${font}`;
            ctx.textAlign = "left";
            ctx.fillStyle = "#ffffff";
            ctx.fillText(high ? "▲ 高い" : "▼ 低い", Math.max(cx, tp.x) + 10, tp.y + (high ? -8 : 16));
          }
        }
      }

      // ---- the sentence rides the melody: each word at its own time, just above its part of the band
      //      (a strong syllable is higher, so its word is too). Sung words turn yellow as far as your
      //      voice was inside the band (all of it once the word is won); the rest stay near-white.
      const wordFont = Math.round(Math.min(22, 17 * scale));
      ctx.font = `700 ${wordFont}px ${latin || font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      let wordEnd = -Infinity;
      let lastY = Y(0) - band / 2 - 8;
      const wordBox: { x: number; y: number; w: number }[] = [];
      for (let i = 0; i < p.words.length; i++) {
        const w = p.words[i];
        const tw = ctx.measureText(w.text).width;
        let top = Infinity;
        for (const seg of p.wave.segments) for (const pt of seg) if (pt.t >= w.start && pt.t <= w.end) top = Math.min(top, Y(pt.st));
        const y = Number.isFinite(top) ? top - band / 2 - 8 : lastY;
        lastY = y;
        const cx = Math.max((X(w.start) + X(w.end)) / 2, wordEnd + 8 + tw / 2);
        wordEnd = cx + tw / 2;
        const yy = Math.max(PAD.t - 6 + wordFont, Math.min(H - PAD.b - 4, y));
        wordBox[i] = { x: cx - tw / 2, y: yy, w: tw };
        if (cx + tw / 2 < -20 || cx - tw / 2 > W + 20) continue;
        // how much of it you sang inside the band
        let hit = 0;
        if (following && bars) {
          const g = wordGrade(bars, p.syllables, i);
          if (g && (g.grade === "great" || g.grade === "perfect")) hit = 1;
          else
            for (const q of live.line)
              if (q.inBand && q.t >= w.start - 0.04 && q.t <= w.end + 0.04) hit = Math.max(hit, Math.min(1, (q.t + 0.06 - w.start) / Math.max(0.05, w.end - w.start)));
        }
        const upcoming = following && cursor < w.start - 0.03;
        ctx.lineJoin = "round";
        ctx.lineWidth = 4;
        ctx.strokeStyle = rgba(col.monitor, 0.9);
        ctx.strokeText(w.text, cx - tw / 2, yy);
        ctx.fillStyle = upcoming ? "rgba(255,255,255,0.9)" : "#ffffff";
        ctx.fillText(w.text, cx - tw / 2, yy);
        if (hit > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(cx - tw / 2 - 2, yy - wordFont - 4, (tw + 4) * hit, wordFont + 10);
          ctx.clip();
          ctx.fillStyle = rgba(col.voice, 1);
          ctx.fillText(w.text, cx - tw / 2, yy);
          ctx.restore();
        }
      }

      // ---- one judgement per word, right above it, once the word is final
      if (bars !== barsKey) {
        barsKey = bars;
        popped = p.words.map(() => false);
        pops.length = 0;
      }
      if (bars && following) {
        for (let wi = 0; wi < p.words.length; wi++) {
          if (popped[wi]) continue;
          const g = wordGrade(bars, p.syllables, wi);
          if (!g) continue;
          popped[wi] = true;
          if (g.grade === "miss") continue; // the caption's gold already says it
          pops.length = 0; // one judgement on screen at a time: the newest word
          pops.push({ word: wi, grade: g.grade, late: g.late, at: now, x0: 0, x1: 0 });
        }
      }
      const cursorX = following ? X(cursor) : Infinity;
      for (let n = pops.length - 1; n >= 0; n--) {
        const pop = pops[n];
        const age = (now - pop.at) / POP_MS;
        if (age >= 1) {
          pops.splice(n, 1);
          continue;
        }
        const w = p.words[pop.word];
        const label = WORD_GRADE_LABEL[pop.grade] ?? "";
        const gold = pop.grade !== "good";
        ctx.font = `800 ${Math.round(Math.min(22, 17 * scale))}px ${latin || font}`;
        const half = ctx.measureText(label).width / 2 + 6;
        // above the word itself (which rides the band)
        const top = (wordBox[pop.word]?.y ?? Y(0) - band / 2) - wordFont - 4;
        const lo = half + EDGE;
        const hi = Math.min(W - half - 8, cursorX - half - 10);
        const x = Math.max(lo, Math.min(hi, (X(w.start) + X(w.end)) / 2));
        const rise = reduce.matches ? 0 : 10 * scale * Math.min(1, age * 1.6);
        const y = Math.max(PAD.t - 2 + 10 * scale, top - 10 - rise);
        // ポン: a quick overshoot, then hold, then fade
        const s = reduce.matches ? 1 : age < 0.14 ? 0.6 + (0.5 * age) / 0.14 : age < 0.26 ? 1.1 - (0.1 * (age - 0.14)) / 0.12 : 1;
        const alpha = age < 0.75 ? 1 : 1 - (age - 0.75) / 0.25;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.scale(s, s);
        ctx.textAlign = "center";
        ctx.lineWidth = 5;
        ctx.strokeStyle = rgba(col.monitor, 1);
        ctx.strokeText(label, 0, 0);
        ctx.fillStyle = gold ? rgba(col.voice, 1) : "#ffffff";
        ctx.fillText(label, 0, 0);
        if (pop.late) {
          ctx.font = `600 ${Math.round(11 * scale)}px ${font}`;
          ctx.fillStyle = "#ffffff";
          ctx.fillText("おそい", 0, 15 * scale);
        }
        ctx.restore();
      }

      // ---- a direct label for your line after the take (no legend)
      // (the band needs no label of its own now: the sentence rides on it)
      if (settled && tp) {
        ctx.textAlign = "left";
        ctx.font = `600 ${Math.round(12 * Math.min(scale, 1.3))}px ${font}`;
        ctx.fillStyle = rgba(col.voice, 1);
        ctx.fillText("あなた", Math.min(W - 44, tp.x + 8), Math.min(H - PAD.b - 2, tp.y + 4));
      }

      // ---- the edges fade out
      for (const [x, dir] of [
        [0, 1],
        [W, -1],
      ] as const) {
        const g = ctx.createLinearGradient(x, 0, x + dir * EDGE, 0);
        g.addColorStop(0, rgba(col.monitor, 1));
        g.addColorStop(1, rgba(col.monitor, 0));
        ctx.fillStyle = g;
        ctx.fillRect(dir > 0 ? 0 : W - EDGE, 0, EDGE, H);
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

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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
