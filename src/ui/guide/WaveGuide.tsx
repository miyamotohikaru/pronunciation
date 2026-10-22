"use client";

/**
 * The guide as a wave — karaoke with a lock-on moment.
 *   - お手本 is one quiet band, exactly ±tolSt semitones thick (the judge's tolerance), with the melody
 *     as a thin bright core: "your line over the band" means "the judge counts it".
 *   - Your line is white: median-smoothed, octave slips of the tracker folded back, broken where you
 *     are unvoiced. Its head is a glowing comet at your latest point — never a line drawn on to the
 *     cursor.
 *   - Lock-on: while your line is inside the band, that stretch of the band fills gold (and the comet
 *     glows gold). Yellow / gold means a hit and nothing else.
 *   - The sentence sits on one line under the band, each word under its own time (as near as it can
 *     be without touching its neighbours), its strong syllable a size up. A word turns yellow as far
 *     as you hit it.
 *   - As you pass a word, its verdict pops as a small separate pill over it and goes.
 *   - Both edges fade out (the pixels themselves, so it works on any card colour).
 *   - After the take: the band, your line over it, the stretches where you were off shaded lightly.
 * One canvas, one requestAnimationFrame loop, inputs from refs, no React state per frame.
 */
import { memo, useEffect, useRef } from "react";
import type { GuideProps } from "./types";
import { WORD_GRADE_LABEL, wordGrade, type WordGrade } from "./grades";

const NOW_X = 0.5; // the word being sung stays in the middle of the card
const EDGE = 44; // px over which the left and right edges fade out
const PAD_T = 22;
const PAD_X = 12;

type RGB = [number, number, number];
const rgb = (hex: string, fb: RGB): RGB => {
  const h = hex.trim().replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return Number.isFinite(n) && h.length >= 3 ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : fb;
};
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

type Pop = { word: number; grade: WordGrade; late: boolean; at: number };
const POP_MS = 1000;
type SmPt = { t: number; st: number | null; inBand: boolean; brk?: boolean };
type Part = { text: string; size: number; w: number };
type Placed = { x: number; w: number; parts: Part[] };

/** the words' size: ≥ 22 px on the practice lane, smaller only in the result's small chart */
const wordSizeFor = (H: number) => (H >= 190 ? 22 : 16);
const bigOf = (size: number) => Math.round(size * 1.2);

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
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    let W = 0;
    let H = 0;
    let dpr = 1;
    let dirty = true;
    // the word layout (cached per scale / size / face)
    let layKey = "";
    let lay: Placed[] = [];

    // the app's one Latin face (words, pills) and the UI gothic (the Japanese cues), as the canvas needs them
    let latin = cs.fontFamily;
    let ja = cs.fontFamily;
    let fontsOk = !document.fonts;
    const readFonts = () => {
      const s = getComputedStyle(wrap);
      latin = s.getPropertyValue("--font-latin").trim() || s.fontFamily;
      ja = s.fontFamily;
    };
    readFonts();
    // words are drawn only once their own face is in: never in a stand-in face
    document.fonts
      ?.load(`700 22px ${latin}`)
      .then(() => document.fonts.load(`800 12px ${latin}`))
      .catch(() => undefined)
      .then(() => {
        fontsOk = true;
        layKey = "";
        dirty = true;
      });

    const resize = (r: { width: number; height: number }) => {
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      W = r.width;
      H = r.height;
      const cw = Math.max(1, Math.round(W * dpr));
      const ch = Math.max(1, Math.round(H * dpr));
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      layKey = "";
      dirty = true;
    };
    const ro = new ResizeObserver((entries) => resize(entries[0].contentRect));
    ro.observe(wrap);
    resize(wrap.getBoundingClientRect());

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

    // ---- your live line, cleaned once per new point. A voice glides: it never jumps 6+ semitones in
    //      one 10 ms frame, so such a jump is the tracker — an octave slip is folded back, anything else
    //      dropped. A run's first point is checked against where your voice has recently been. The two
    //      onset frames of a run (unsteady) are not drawn; then a causal 5-point median.
    let smKey: unknown = null;
    let sm: SmPt[] = [];
    let done = 0;
    let run: number[] = [];
    let hist: number[] = [];
    let onset = 0;
    let prevSt = 0;
    let shown = 0; // the drawn value: it follows the median at ≤ 1 semitone per frame (no vertical strokes)
    let lastT = -1;
    const smoothLive = (line: readonly { t: number; st: number | null; inBand?: boolean }[]) => {
      if (line !== smKey || line.length < done) {
        smKey = line;
        sm = [];
        done = 0;
        run = [];
        hist = [];
        onset = 0;
        lastT = -1;
      }
      for (; done < line.length; done++) {
        const q = line[done];
        const fresh = q.st === null || q.t - lastT > 0.06;
        if (fresh) {
          run = [];
          onset = 0;
        }
        if (q.st === null) {
          sm.push({ t: q.t, st: null, inBand: false });
          continue;
        }
        let st = q.st;
        const ref = run.length ? prevSt : hist.length >= 5 ? median(hist) : 0;
        const tol = run.length ? 6 : 9;
        if (Math.abs(st - ref) > tol) {
          const folded = st - 12 * Math.round((st - ref) / 12);
          if (Math.abs(folded - ref) > (run.length ? 3 : 6)) continue; // not an octave: a glitch, skipped
          st = folded;
        }
        if (run.length && Math.abs(st - prevSt) > 3.5) {
          // a jump, not a glide (a voice never moves 3.5 semitones in one frame): the line breaks here
          sm.push({ t: q.t - 0.001, st: null, inBand: false, brk: true });
          run = [];
          onset = 0;
        }
        prevSt = st;
        lastT = q.t;
        run.push(st);
        if (run.length > 5) run.shift();
        hist.push(st);
        if (hist.length > 40) hist.shift();
        if (++onset <= 2) continue;
        const m = median(run);
        shown = onset === 3 ? m : shown + Math.max(-1, Math.min(1, m - shown));
        sm.push({ t: q.t, st: shown, inBand: !!q.inBand });
      }
      return sm;
    };

    // ---- the sentence's line: each word as near its own time as it can be without touching the next
    //      (least squares in order = isotonic regression); strong syllables a size up
    // the words measured once per size and face (text width scales with the size)
    let measKey = "";
    let meas: { parts: Part[][]; widths: number[] } = { parts: [], widths: [] };
    let rowFits = true; // the whole line fits the view at the smallest size (before / after a take)
    const layoutWords = (B: number, k: number) => {
      const p = propsRef.current;
      const size0 = wordSizeFor(H);
      const big0 = bigOf(size0);
      const mk = `${versionRef.current}|${size0}|${latin}`;
      if (mk !== measKey) {
        measKey = mk;
        meas = { parts: [], widths: [] };
        for (let i = 0; i < p.words.length; i++) {
          const list: Part[] = splitWord(p.words[i].text, p.pieces?.[i], size0, big0);
          let tw = 0;
          for (const part of list) {
            ctx.font = `700 ${part.size}px ${latin}`;
            part.w = ctx.measureText(part.text).width;
            tw += part.w;
          }
          meas.parts.push(list);
          meas.widths.push(tw);
        }
      }
      // before and after a take the whole line is in view: its words shrink to fit the width
      // (down to 11 px); while you sing they are at full size (≥ 22 px), riding with the playhead
      const need = meas.widths.reduce((a, w) => a + w, 0) + Math.max(0, meas.widths.length - 1) * Math.round(size0 * 0.55);
      const room = W - 2 * PAD_X - 8;
      const fitK = Math.max(11 / size0, Math.min(1, room / Math.max(1, need)));
      rowFits = need * fitK <= room + 1;
      const sc = fitK + (1 - fitK) * k;
      const size = size0 * sc;
      const key = `${measKey}|${B.toFixed(3)}|${sc.toFixed(3)}`;
      if (key === layKey) return;
      layKey = key;
      const n = p.words.length;
      const parts: Part[][] = meas.parts.map((list) => list.map((x) => ({ text: x.text, size: x.size * sc, w: x.w * sc })));
      const widths: number[] = meas.widths.map((w) => w * sc);
      const gap = Math.round(size * 0.55);
      const off: number[] = [];
      const target: number[] = [];
      let acc = 0;
      for (let i = 0; i < n; i++) {
        if (i > 0) acc += (widths[i - 1] + widths[i]) / 2 + gap;
        off.push(acc);
        target.push(B * ((p.words[i].start + p.words[i].end) / 2) - acc);
      }
      const q = isotonic(target);
      lay = q.map((v, i) => ({ x: v + off[i], w: widths[i], parts: parts[i] }));
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

      const size = wordSizeFor(H);
      const big = bigOf(size);
      const base = H - 14; // the words' baseline
      const plotB = H - big - 26; // the band lives above the words' line
      const innerW = W - 2 * PAD_X;
      const cursor = live.t ?? 0;
      const fitA = PAD_X - (t0 * innerW) / (t1 - t0);
      const fitB = innerW / (t1 - t0);
      const folB = innerW / secPerView();
      const folA = W * NOW_X - cursor * folB;
      const A = fitA + (folA - fitA) * k;
      const B = fitB + (folB - fitB) * k;
      const X = (t: number) => A + B * t;
      const pxPerSt = (plotB - PAD_T) / (st1 - st0);
      const Y = (st: number) => PAD_T + (st1 - st) * pxPerSt;
      const clampY = (y: number) => Math.min(plotB + 6, Math.max(PAD_T - 10, y));
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
      ctx.textBaseline = "alphabetic";

      // after the take: where you were off, shaded lightly behind everything
      if (settled && p.offStretches) {
        ctx.fillStyle = rgba(col.miss, 0.2);
        for (const r of p.offStretches) {
          const x0 = X(r.start);
          const x1 = X(r.end);
          if (x1 > x0) ctx.fillRect(x0, PAD_T - 8, x1 - x0, plotB - PAD_T + 14);
        }
      }

      // ---- your line, cleaned (live) or as the take scored it (after)
      const pts: readonly SmPt[] = settled ? smoothLine(p.overlay!).map((q) => ({ t: q.t, st: q.st, inBand: q.st !== null && Math.abs(q.st - guideAt(p.wave, q.t)) <= tol })) : smoothLive(live.line);
      const upTo = settled ? (p.progressive ? Math.min(live.t ?? -1, (p.syllables[p.syllables.length - 1]?.end ?? 1e9) + 0.08) : (p.syllables[p.syllables.length - 1]?.end ?? 1e9) + 0.08) : null;

      // ---- お手本: all segments in ONE path (no seams), lightly smoothed (±3 points)
      const melody = new Path2D();
      let any = false;
      for (const seg of p.wave.segments) {
        if (seg.length < 2 || seg[seg.length - 1].t < tVis0 - 0.5 || seg[0].t > tVis1 + 0.5) continue;
        const ys = seg.map((_, i) => {
          let sum = 0;
          let n = 0;
          for (let j = Math.max(0, i - 3); j <= Math.min(seg.length - 1, i + 3); j++) {
            sum += seg[j].st;
            n++;
          }
          return Y(sum / n);
        });
        melody.moveTo(X(seg[0].t), ys[0]);
        for (let i = 1; i < seg.length - 1; i++) melody.quadraticCurveTo(X(seg[i].t), ys[i], (X(seg[i].t) + X(seg[i + 1].t)) / 2, (ys[i] + ys[i + 1]) / 2);
        melody.lineTo(X(seg[seg.length - 1].t), ys[seg.length - 1]);
        any = true;
      }
      // lock-on: the time sections where your line was inside the band (gaps under 80 ms don't split one)
      const gold: [number, number][] = [];
      {
        let ga = -1;
        let gb = -1;
        for (const q of pts) {
          if (upTo !== null && q.t > upTo) break;
          if (q.st === null || !q.inBand) continue;
          if (ga < 0 || q.t - gb > 0.08) {
            if (ga >= 0) gold.push([ga, gb]);
            ga = q.t;
          }
          gb = q.t;
        }
        if (ga >= 0) gold.push([ga, gb]);
      }
      if (any) {
        // one gradient across the view: sung parts fade as they scroll away
        const xa = Math.max(0, X(tVis0));
        const xb = Math.min(W, X(tVis1));
        const halo = ctx.createLinearGradient(xa, 0, Math.max(xa + 1, xb), 0);
        const core = ctx.createLinearGradient(xa, 0, Math.max(xa + 1, xb), 0);
        for (let j = 0; j <= 24; j++) {
          const t = tVis0 + ((tVis1 - tVis0) * j) / 24;
          const f = fade(t);
          halo.addColorStop(j / 24, rgba(col.guide, 0.17 * f));
          core.addColorStop(j / 24, rgba(col.guide, 0.92 * f));
        }
        ctx.strokeStyle = halo;
        ctx.lineWidth = band;
        ctx.stroke(melody);
        // lock-on: that section of the band fills gold, like a note bar filling as you hold it — one
        // gradient along the view, soft ends, brighter the longer you stayed on (a blip is only a hint)
        if (gold.length) {
          const g = ctx.createLinearGradient(0, 0, W, 0);
          let pos = 0;
          const stop = (x: number, a: number) => {
            pos = Math.max(pos, Math.min(1, Math.max(0, x / W)));
            g.addColorStop(pos, rgba(col.voice, a));
          };
          stop(0, 0);
          let anyGold = false;
          for (const [a, b] of gold) {
            const x0 = X(a);
            const x1 = X(b);
            if (x1 < -12 || x0 > W + 12 || b - a < 0.05) continue;
            const f = (settled ? 0.42 : 0.62) * Math.min(1, 0.3 + (b - a) / 0.35) * fade(b);
            const ramp = Math.min(6, (x1 - x0) / 2);
            stop(x0 - 5, 0);
            stop(x0 + ramp, f);
            stop(x1 - ramp, f);
            stop(x1 + 5, 0);
            anyGold = true;
          }
          if (anyGold) {
            stop(W, 0);
            ctx.strokeStyle = g;
            ctx.lineWidth = band;
            ctx.stroke(melody);
          }
        }
        ctx.strokeStyle = core;
        ctx.lineWidth = Math.max(2, 2.2 * scale);
        ctx.stroke(melody);
      }

      // ---- the playhead: over the band only (it never runs through the words' line)
      if (live.t !== null) {
        const x = X(live.t);
        ctx.strokeStyle = following ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.9)";
        ctx.lineWidth = following ? 1.5 : 2;
        ctx.beginPath();
        ctx.moveTo(x, PAD_T - 14);
        ctx.lineTo(x, plotB + 8);
        ctx.stroke();
      }

      // ---- your line: white, glowing; broken where you were unvoiced (40 ms+), specks not drawn
      const gapS = settled ? 0.06 : 0.045;
      let tip: { x: number; y: number; t: number; st: number; inBand: boolean } | null = null;
      let tail: { x: number; y: number; t: number }[] = [];
      let runPts: { x: number; y: number; t: number; inBand: boolean; st: number }[] = [];
      const flush = () => {
        const n = runPts.length;
        if (n >= 3) {
          const a = fade(runPts[n - 1].t);
          ctx.beginPath();
          ctx.moveTo(runPts[0].x, runPts[0].y);
          for (let i = 1; i < n; i++) {
            const last = i === n - 1;
            const mx = last ? runPts[i].x : (runPts[i].x + runPts[i + 1].x) / 2;
            const my = last ? runPts[i].y : (runPts[i].y + runPts[i + 1].y) / 2;
            ctx.quadraticCurveTo(runPts[i].x, runPts[i].y, mx, my);
          }
          ctx.strokeStyle = `rgba(255,255,255,${0.16 * a})`;
          ctx.lineWidth = 9 * scale;
          ctx.stroke();
          ctx.strokeStyle = `rgba(255,255,255,${0.95 * a})`;
          ctx.lineWidth = 3 * scale;
          ctx.stroke();
          const l = runPts[n - 1];
          tip = { x: l.x, y: l.y, t: l.t, st: l.st, inBand: l.inBand };
          tail = runPts.filter((q) => q.t >= l.t - 0.22);
        }
        runPts = [];
      };
      let prevT = -1;
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        if (upTo !== null && q.t > upTo) break;
        if (q.t < tVis0 - 0.3) continue;
        if (q.st === null) {
          // unvoiced: a run ends once the voice has been away 40 ms+ (below); a jump ends it at once
          if (q.brk) flush();
          continue;
        }
        if (q.t - prevT > gapS) flush();
        if (q.t > tVis1) break;
        runPts.push({ x: X(q.t), y: clampY(Y(q.st)), t: q.t, inBand: q.inBand, st: q.st });
        prevT = q.t;
      }
      flush();
      const tp = tip as { x: number; y: number; t: number; st: number; inBand: boolean } | null;
      const voicing = !settled && following && !!tp && cursor - tp.t < 0.25;
      if (voicing && tp) {
        // the comet: a bright tail over the last ~0.2 s and a glowing head at your latest point
        const lock = tp.inBand;
        const c: RGB = lock ? col.voice : [255, 255, 255];
        if (tail.length >= 2) {
          const g = ctx.createLinearGradient(tail[0].x, 0, Math.max(tail[0].x + 1, tp.x), 0);
          g.addColorStop(0, rgba(c, 0));
          g.addColorStop(1, rgba(c, 0.85));
          ctx.strokeStyle = g;
          ctx.lineWidth = 6.5 * scale;
          ctx.beginPath();
          ctx.moveTo(tail[0].x, tail[0].y);
          for (let i = 1; i < tail.length; i++) ctx.lineTo(tail[i].x, tail[i].y);
          ctx.stroke();
        }
        const r = (lock ? 21 : 15) * scale;
        const halo = ctx.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, r);
        halo.addColorStop(0, rgba(c, 0.95));
        halo.addColorStop(0.32, rgba(c, 0.5));
        halo.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, 4.4 * scale, 0, Math.PI * 2);
        ctx.fill();
        // one cue at a time: while a word's verdict is up, no 高い / 低い
        const popUp = pops.length > 0 && now - pops[0].at < POP_MS;
        if (!lock && !popUp) {
          const g = guideAt(p.wave, cursor);
          if (Number.isFinite(g)) {
            const high = tp.st > g;
            ctx.font = `600 ${Math.round(12 * Math.min(scale, 1.3))}px ${ja}`;
            ctx.textAlign = "left";
            ctx.fillStyle = "#ffffff";
            ctx.fillText(high ? "▲ 高い" : "▼ 低い", tp.x + 14, Math.max(PAD_T, Math.min(plotB, tp.y + (high ? -10 : 18))));
          }
        }
      }

      // ---- the sentence on one line under the band; yellow only as far as you hit each word
      if (fontsOk && p.words.length) {
        layoutWords(B, k);
      }
      // a line too long for the view at any readable size shows its words only while you sing
      // (before and after, the caption above has the whole line)
      if (fontsOk && p.words.length && (rowFits || k > 0.02)) {
        ctx.save();
        if (!rowFits) ctx.globalAlpha = k;
        let font = "";
        const drawParts = (parts: Part[], x0: number) => {
          let x = x0;
          for (const part of parts) {
            const f = `700 ${part.size.toFixed(1)}px ${latin}`;
            if (f !== font) {
              ctx.font = f;
              font = f;
            }
            ctx.fillText(part.text, x, base);
            x += part.w;
          }
        };
        ctx.textAlign = "left";
        for (let i = 0; i < p.words.length; i++) {
          const L = lay[i];
          if (!L) continue;
          const left = A + L.x - L.w / 2;
          if (left > W + 10 || left + L.w < -10) continue;
          const w = p.words[i];
          let hit = 0;
          if (following && bars) {
            const g = wordGrade(bars, p.syllables, i);
            if (g && (g.grade === "great" || g.grade === "perfect")) hit = 1;
            else
              for (const q of live.line)
                if (q.inBand && q.t >= w.start - 0.04 && q.t <= w.end + 0.04) hit = Math.max(hit, Math.min(1, (q.t + 0.06 - w.start) / Math.max(0.05, w.end - w.start)));
          }
          const upcoming = following && cursor < w.start - 0.03;
          const passed = following && cursor > w.end + 0.03;
          ctx.fillStyle = upcoming ? "rgba(255,255,255,0.9)" : passed ? "rgba(255,255,255,0.7)" : "#ffffff";
          drawParts(L.parts, left);
          if (hit > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(left - 2, base - big - 6, (L.w + 4) * hit, big + 14);
            ctx.clip();
            ctx.fillStyle = rgba(col.voice, 1);
            drawParts(L.parts, left);
            ctx.restore();
          }
        }
        ctx.restore();
      }

      // ---- one verdict per word, as you pass it: a small pill over the word, then gone
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
          if (g.grade === "miss") continue; // the word's own colour already says it
          pops.length = 0; // one verdict on screen at a time: the newest word
          pops.push({ word: wi, grade: g.grade, late: g.late, at: now });
        }
      }
      for (let n = pops.length - 1; n >= 0; n--) {
        const pop = pops[n];
        const age = (now - pop.at) / POP_MS;
        const L = lay[pop.word];
        if (age >= 1 || !L || !fontsOk) {
          if (age >= 1) pops.splice(n, 1);
          continue;
        }
        const label = WORD_GRADE_LABEL[pop.grade] ?? "";
        const fs = Math.round(11 * Math.min(1.25, Math.max(1, scale)));
        ctx.font = `800 ${fs}px ${latin}`;
        const lw = ctx.measureText(label).width;
        let lateW = 0;
        if (pop.late) {
          ctx.font = `700 ${fs}px ${ja}`;
          lateW = ctx.measureText("おそい").width + 6;
        }
        const pw = lw + lateW + 16;
        const ph = fs + 11;
        const x = Math.max(EDGE * 0.6 + pw / 2, Math.min(W - EDGE * 0.6 - pw / 2, A + L.x));
        const rise = reduce.matches ? 0 : 6 * Math.min(1, age * 2);
        const y = base - big - 8 - ph / 2 - rise;
        // ポン: a quick overshoot, then hold, then fade
        const s = reduce.matches ? 1 : age < 0.12 ? 0.55 + (0.6 * age) / 0.12 : age < 0.24 ? 1.15 - (0.15 * (age - 0.12)) / 0.12 : 1;
        const alpha = age < 0.72 ? 1 : 1 - (age - 0.72) / 0.28;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.scale(s, s);
        roundRect(ctx, -pw / 2, -ph / 2, pw, ph, ph / 2);
        const solid = pop.grade !== "good";
        ctx.fillStyle = solid ? "#ffffff" : "rgba(255,255,255,0.2)";
        ctx.fill();
        if (pop.grade === "perfect") {
          ctx.strokeStyle = rgba(col.voice, 1);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = solid ? rgba(col.monitor, 1) : "#ffffff";
        ctx.font = `800 ${fs}px ${latin}`;
        ctx.fillText(label, -pw / 2 + 8, 0.5);
        if (pop.late) {
          ctx.font = `700 ${fs}px ${ja}`;
          ctx.fillText("おそい", -pw / 2 + 8 + lw + 6, 0.5);
        }
        ctx.restore();
        ctx.textBaseline = "alphabetic";
      }

      // ---- a direct label for your line after the take (no legend)
      if (settled && tp) {
        ctx.textAlign = "left";
        ctx.font = `600 ${Math.round(12 * Math.min(scale, 1.3))}px ${ja}`;
        ctx.fillStyle = "#ffffff";
        ctx.fillText("あなた", Math.min(W - 44, tp.x + 8), Math.min(plotB, tp.y + 4));
      }

      // ---- both edges fade out: the pixels themselves, so the card's own colour shows through
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      const gl = ctx.createLinearGradient(0, 0, EDGE, 0);
      gl.addColorStop(0, "rgba(0,0,0,1)");
      gl.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gl;
      ctx.fillRect(0, 0, EDGE, H);
      const gr = ctx.createLinearGradient(W - EDGE, 0, W, 0);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = gr;
      ctx.fillRect(W - EDGE, 0, EDGE, H);
      ctx.restore();

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

/**
 * A word as drawn: its syllables (strong one at `big`) when the pieces spell it (letters compared, so
 * "home," and "home" match; punctuation rides on the last piece), else the word whole at `size`.
 */
function splitWord(text: string, pcs: readonly { text: string; strong: boolean }[] | null | undefined, size: number, big: number): Part[] {
  const letters = (x: string) => x.replace(/[^A-Za-z']/g, "");
  if (!pcs || !pcs.length || pcs.map((x) => letters(x.text)).join("") !== letters(text)) return [{ text, size, w: 0 }];
  const out: Part[] = [];
  let at = 0;
  for (let k = 0; k < pcs.length; k++) {
    const want = letters(pcs[k].text).length;
    let got = 0;
    let end = at;
    while (end < text.length && (got < want || (k === pcs.length - 1 && end < text.length))) {
      if (/[A-Za-z']/.test(text[end])) got++;
      end++;
    }
    // leading punctuation of the next piece stays with this one
    out.push({ text: text.slice(at, end), size: pcs[k].strong ? big : size, w: 0 });
    at = end;
  }
  return out.filter((x) => x.text.length > 0);
}

/** the non-decreasing sequence nearest to r (least squares): pool adjacent violators */
function isotonic(r: readonly number[]): number[] {
  const val: number[] = [];
  const cnt: number[] = [];
  for (const v of r) {
    val.push(v);
    cnt.push(1);
    while (val.length > 1 && val[val.length - 2] > val[val.length - 1]) {
      const v2 = val.pop()!;
      const c2 = cnt.pop()!;
      const v1 = val.pop()!;
      const c1 = cnt.pop()!;
      val.push((v1 * c1 + v2 * c2) / (c1 + c2));
      cnt.push(c1 + c2);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < val.length; i++) for (let j = 0; j < cnt[i]; j++) out.push(val[i]);
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
