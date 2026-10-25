"use client";

/**
 * The sound card's mouth: a professionally drawn mid-sagittal section (Wright & McCloy, CC0 — see
 * sagittal-data.ts and /credits), cut close around the mouth so the tongue's tip reads. Only the
 * tongue, jaw and lower lip move: they are the blend of two drawings — the sound it was heard as and
 * お手本's — and the card drags, springs and plays them.
 *   - Yellow is your tongue and nothing else (the jaw, teeth and lips stay anatomy grey).
 *   - お手本's tongue: a blue dashed line.
 *   - ① the arrow from your tongue to お手本's (or the spot to touch, ●), ② the lips (r: rounded,
 *     forward) — the same numbers as the steps under the picture; a pink ✕ where it must not touch.
 *   - No words in the picture (the steps say it once); the legend sits under it, not on the drawing.
 *   - Every line is 2 px or more; the picture is a rounded window, so nothing is cut square.
 * Colours: blue = お手本, yellow = your recording, pink = the "don't".
 *
 * With お手本 only (`heard` null) the tongue is blue and moves by itself: to a new `target` (from the
 * one before, ~250 ms), and on `api.morph(shape)` to another sound and back (a pair's other word, a
 * diphthong's glide) — drawn from refs, no React render per frame.
 */
import { useLayoutEffect, useRef } from "react";
import { SAGITTAL_SHAPES, SAGITTAL_STATIC } from "./sagittal-data";
import { TIP, blend, closedPath, outline, tipOf, tongueStart, type Pt, type ShapeKey } from "./geometry";

export type SagittalApi = {
  /** お手本's tongue moves to `to`'s shape (null: back to the target's), over `ms` */
  morph: (to: ShapeKey | null, ms?: number) => void;
};

export type SagittalRefs = {
  svg?: { current: SVGSVGElement | null };
  /** your tongue (yellow) */
  body?: { current: SVGPathElement | null };
  /** the line round your tongue */
  bodyLine?: { current: SVGPathElement | null };
  /** the moving anatomy (jaw, lower teeth and lip, tongue) in grey */
  edge?: { current: SVGPathElement | null };
  grip?: { current: SVGGElement | null };
  /** ① the arrow from your tongue to お手本's */
  arrow?: { current: SVGPathElement | null };
};

export type SagittalProps = {
  /** お手本's sound */
  target: ShapeKey;
  /** what it was heard as (null: お手本 only, nothing to drag) */
  heard: ShapeKey | null;
  /** 0 = お手本 … 1 = what it was heard as: where the yellow tongue is */
  pos: number;
  /** a clip plays: お手本's line glows */
  active?: boolean;
  grip?: boolean;
  refs?: SagittalRefs;
  className?: string;
  /** numbered marks (the numbers of the steps under the picture they show): the tongue's way, the lips */
  marks?: { tongue?: 1 | 2; lips?: 1 | 2 };
  /** お手本 only: moves the tongue to another sound and back (see SagittalApi) */
  api?: { current: SagittalApi | null };
  /** お手本 only: how long a change of `target` takes (ms; 0 = at once) */
  morphMs?: number;
};

/** the window: the mouth from the back of the tongue to the lips */
export const SAG_VIEW = { x: 102, y: 105, w: 70, h: 58 };
const GREY = "#e3e6ef";
const LINE = "#868ca6";
const W_LINE = 0.46; // ≈ 2.1 px at the card's width
const ROOT_Y = 168; // the tongue is drawn down to here (below the window)

/** the tongue's part of every outline: from the floor behind the lower teeth, round the tip, to the root */
export function tongueRange(target: ShapeKey, heard: ShapeKey | null): [number, number] {
  const a = outline(target);
  const ts = Math.max(tongueStart(a), heard ? tongueStart(outline(heard)) : 0);
  const end = (o: Pt[]) => {
    for (let i = TIP; i < o.length; i++) if (o[i][1] > ROOT_Y) return i;
    return o.length - 1;
  };
  return [ts, Math.max(end(a), heard ? end(outline(heard)) : 0)];
}

/** お手本 alone: one tongue range for every shape, so any two can be blended and drawn alike */
let modelRange: [number, number] | null = null;
function modelRangeOf(): [number, number] {
  if (modelRange) return modelRange;
  let ts = 0;
  let re = 0;
  for (const k of Object.keys(SAGITTAL_SHAPES) as ShapeKey[]) {
    const [a, b] = tongueRange(k, null);
    ts = Math.max(ts, a);
    re = Math.max(re, b);
  }
  return (modelRange = [ts, re]);
}

/**
 * your tongue as a filled shape (yellow): its outline, closed down below the window (so no closing
 * edge is ever seen); the line round it is drawn separately (tongueLine)
 */
export function tonguePath(pts: Pt[], range: [number, number]): string {
  const t = pts.slice(range[0], range[1] + 1);
  const a = t[0];
  const b = t[t.length - 1];
  const low = SAG_VIEW.y + SAG_VIEW.h + 12;
  return `${closedPath([...t, [b[0], low], [a[0] + 1.5, low]]).replace(/ Z$/, "")} Z`;
}

/** a tongue's outline as an open line, from just under its tip round its back */
export function tongueLine(pts: Pt[], range: [number, number]): string {
  return `M${pts
    .slice(Math.max(range[0], TIP - 14), range[1] + 1)
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" L")}`;
}

/** where ① points: the tip for the tongue-tip sounds, the top of the tongue for the vowels and k */
export function keyIndex(target: ShapeKey): number {
  if (target === "r" || target === "t" || target === "th" || target === "s" || target === "sh" || target === "b" || target === "f") return TIP;
  const o = outline(target);
  let best = TIP;
  for (let i = TIP; i < o.length && o[i][1] <= ROOT_Y; i++) if (o[i][1] < o[best][1] && o[i][0] > 112) best = i;
  return best;
}

/** where the grip sits: on your tongue a little behind the tip (clear of the ✕ and the arrow's head) */
export const GRIP = TIP + 15;

/** the contact mark for お手本's sound: must touch (●) or must not touch (✕), and where */
function contactFor(target: ShapeKey): { kind: "do" | "dont"; at: Pt } | null {
  const tip = (k: ShapeKey) => tipOf(outline(k));
  switch (target) {
    case "r":
      return { kind: "dont", at: tip("t") };
    case "t":
      return { kind: "do", at: tip("t") };
    case "th":
      return { kind: "do", at: tip("th") };
    case "f":
      return { kind: "do", at: [157.4, 141.6] };
    default:
      return null;
  }
}

/** ✕ on the ridge just above the spot where the tip would touch (clear of the arrow under it) */
function xMark(at: Pt): string {
  const c: Pt = [at[0] + 1.2, at[1] - 4.4];
  const r = 1.6;
  return `M${c[0] - r},${c[1] - r} L${c[0] + r},${c[1] + r} M${c[0] + r},${c[1] - r} L${c[0] - r},${c[1] + r}`;
}

/** ① as a path: a line with its head, from your tongue to お手本's */
export function arrowPath(from: Pt, to: Pt): string {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const l = 2.1;
  const p1: Pt = [to[0] - l * Math.cos(ang - 0.55), to[1] - l * Math.sin(ang - 0.55)];
  const p2: Pt = [to[0] - l * Math.cos(ang + 0.55), to[1] - l * Math.sin(ang + 0.55)];
  const f = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  return `M${f(from)} L${f(to)} M${f(p1)} L${f(to)} L${f(p2)}`;
}

/** ② the lips pushed forward and rounded (r, sh): the upper lip (fixed drawing) and your lower lip, moved */
function lipsForward(lower: Pt[]): string {
  const upper: Pt[] = [
    [156.2, 137.0], [157.0, 137.1], [158.0, 137.0], [158.8, 136.6], [159.8, 135.9], [160.6, 134.8], [160.9, 134.2], [161.1, 132.9], [161.0, 130.8], [159.4, 124.4],
  ];
  const mv = (p: Pt, dx: number, dy: number): Pt => [p[0] + dx, p[1] + dy];
  const f = (ps: Pt[]) => `M${ps.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" L")}`;
  return `${f(upper.map((p) => mv(p, 2.6, 0.8)))} ${f(lower.map((p) => mv(p, 2.6, -0.8)))}`;
}

export function sagittalPoints(target: ShapeKey, heard: ShapeKey | null, pos: number): Pt[] {
  const a = outline(target);
  return heard ? blend(a, outline(heard), pos) : a;
}

/** the grip sits on the tongue a little behind its tip (the same index in every outline) */
export const gripIndex = (): number => GRIP;

/** a numbered badge (① ②): ink disc, white figure — the same as the steps' numbers */
function Badge({ at, n }: { at: Pt; n: number }) {
  return (
    <g transform={`translate(${at[0].toFixed(2)},${at[1].toFixed(2)})`} aria-hidden>
      <circle r="2.7" fill="var(--ink)" stroke="#fff" strokeWidth="0.55" />
      <text y="1.25" fontSize="3.5" fontWeight="700" textAnchor="middle" fill="#fff" style={{ fontFamily: "system-ui, sans-serif" }}>
        {n}
      </text>
    </g>
  );
}

export default function Sagittal({ target, heard, pos, active, grip, refs, className, marks, api, morphMs = 250 }: SagittalProps) {
  const a = outline(target);
  const range = heard ? tongueRange(target, heard) : modelRangeOf();
  // お手本 alone: its tongue's paths, drawn from refs while it moves
  const mEdge = useRef<SVGPathElement>(null);
  const mFill = useRef<SVGPathElement>(null);
  const mLine = useRef<SVGPathElement>(null);
  const mMark = useRef<SVGGElement>(null);
  const cur = useRef<Pt[] | null>(null);
  const raf = useRef(0);
  const shown = useRef<ShapeKey>(target);
  useLayoutEffect(() => {
    if (heard) {
      cancelAnimationFrame(raf.current);
      cur.current = null;
      if (api) api.current = null;
      return;
    }
    const R = modelRangeOf();
    const draw = (pts: Pt[]) => {
      mEdge.current?.setAttribute("d", closedPath(pts));
      mFill.current?.setAttribute("d", tonguePath(pts, R));
      mLine.current?.setAttribute("d", tongueLine(pts, R));
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const go = (to: ShapeKey, ms: number) => {
      cancelAnimationFrame(raf.current);
      const dest = outline(to);
      const from = cur.current ?? dest;
      if (mMark.current) mMark.current.style.opacity = to === target ? "1" : "0";
      if (reduce || ms <= 0 || from === dest) {
        cur.current = dest;
        draw(dest);
        return;
      }
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        cur.current = k < 1 ? blend(from, dest, 1 - Math.pow(1 - k, 3)) : dest;
        draw(cur.current);
        if (k < 1) raf.current = requestAnimationFrame(step);
      };
      draw(from); // before the first paint: the old shape, then it moves
      raf.current = requestAnimationFrame(step);
    };
    // a new sound: from the tongue as it was to the new one
    if (shown.current !== target || !cur.current) go(target, cur.current ? morphMs : 0);
    shown.current = target;
    if (api) api.current = { morph: (to, ms = 320) => go(to ?? target, ms) };
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, heard]);
  const now = sagittalPoints(target, heard, pos);
  const contact = contactFor(target);
  const ki = keyIndex(target);
  const from = heard ? now[ki] : null;
  const to = a[ki];
  const far = from ? Math.hypot(to[0] - from[0], to[1] - from[1]) : 0;
  // ① sits beside the arrow's middle, on the side away from the roof of the mouth
  const mid: Pt | null = from ? [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2] : null;
  const tongueAt: Pt | null = marks?.tongue ? (contact && contact.kind === "do" && (!from || far < 1.5) ? [contact.at[0] - 4.2, contact.at[1] + 4.6] : mid && far >= 1.5 ? [mid[0] - 1.2, mid[1] + 5.2] : [to[0] - 4.2, to[1] + 4.6]) : null;
  const lower = now.slice(57, 69);
  const lipsAt: Pt | null = marks?.lips ? [166.4, 143.2] : null;
  const fadeId = `sag-fade-${target}`;
  return (
    <svg
      ref={refs?.svg}
      viewBox={`${SAG_VIEW.x} ${SAG_VIEW.y} ${SAG_VIEW.w} ${SAG_VIEW.h}`}
      className={className}
      role="img"
      aria-label={`口の断面図。${heard ? "黄色があなたの録音の舌、" : ""}青の点線がお手本の舌${contact ? `。${contact.kind === "do" ? "●の所に付ける" : "✕の所には付けない"}` : ""}`}
    >
      <defs>
        {/* your tongue: yellow, fading out toward the floor of the mouth */}
        <linearGradient id={fadeId} x1="0" x2="0" y1={SAG_VIEW.y} y2={SAG_VIEW.y + SAG_VIEW.h} gradientUnits="userSpaceOnUse">
          <stop offset="0.55" stopColor="var(--voice-fill)" stopOpacity="0.95" />
          <stop offset="1" stopColor="var(--voice-fill)" stopOpacity="0.35" />
        </linearGradient>
        <filter id="sag-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
      </defs>

      {/* the parts that never move */}
      <path d={SAGITTAL_STATIC.path9} fill={GREY} stroke={LINE} strokeWidth={W_LINE} strokeLinejoin="round" />
      <path d={SAGITTAL_STATIC.path7} fill={GREY} stroke={LINE} strokeWidth={W_LINE} strokeLinejoin="round" />
      <path d={SAGITTAL_STATIC.path13} fill={GREY} stroke={LINE} strokeWidth={W_LINE} strokeLinejoin="round" />

      {/* jaw, lower teeth and lip, tongue: anatomy grey; then your tongue alone in yellow */}
      <path ref={heard ? refs?.edge : mEdge} d={closedPath(now)} fill={GREY} stroke={LINE} strokeWidth={W_LINE} strokeLinejoin="round" />
      {heard ? (
        <>
          <path ref={refs?.body} d={tonguePath(now, range)} fill={`url(#${fadeId})`} />
          <path ref={refs?.bodyLine} d={tongueLine(now, range)} fill="none" stroke="var(--voice-ink)" strokeWidth={W_LINE} strokeLinejoin="round" strokeLinecap="round" />
        </>
      ) : null}

      {/* お手本's tongue: blue dashed (it glows while a clip plays); alone, it is filled lightly */}
      {heard ? (
        <>
          <path d={tongueLine(a, range)} fill="none" stroke="var(--guide)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" filter="url(#sag-glow)" style={{ opacity: active ? 0.85 : 0, transition: "opacity 160ms" }} />
          <path d={tongueLine(a, range)} fill="none" stroke="var(--guide-ink)" strokeWidth="0.62" strokeDasharray="1.9 1.3" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path ref={mFill} d={tonguePath(a, range)} fill="color-mix(in srgb, var(--guide) 22%, white)" />
          <path ref={mLine} d={tongueLine(a, range)} fill="none" stroke="var(--guide-ink)" strokeWidth="0.62" strokeDasharray="1.9 1.3" strokeLinejoin="round" strokeLinecap="round" />
        </>
      )}

      {/* ② the lips: rounded and pushed forward (r, sh) */}
      {marks?.lips ? <path d={lipsForward(lower)} fill="none" stroke="var(--guide-ink)" strokeWidth="0.62" strokeDasharray="1.9 1.3" strokeLinecap="round" strokeLinejoin="round" /> : null}

      {/* where it must touch (●) or must not (✕) */}
      {contact ? (
        <g ref={heard ? undefined : mMark} data-mark="contact" className={active && contact.kind === "dont" ? "kara-blink" : undefined} style={{ transition: "opacity 140ms" }}>
          {contact.kind === "do" ? (
            <circle cx={contact.at[0]} cy={contact.at[1]} r="1.5" fill="var(--guide-ink)" stroke="#fff" strokeWidth="0.55" />
          ) : (
            <g stroke="var(--miss)" strokeWidth="0.75" strokeLinecap="round">
              <path d={xMark(contact.at)} stroke="#fff" strokeWidth="1.7" />
              <path d={xMark(contact.at)} />
            </g>
          )}
        </g>
      ) : null}

      {/* ① the way to go, from your tongue to お手本's */}
      {from ? (
        <path
          ref={refs?.arrow}
          data-mark="arrow"
          d={far >= 1.5 ? arrowPath(from, to) : ""}
          fill="none"
          stroke="var(--guide-ink)"
          strokeWidth="0.62"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {tongueAt && marks?.tongue ? <Badge at={tongueAt} n={marks.tongue} /> : null}
      {lipsAt && marks?.lips ? <Badge at={lipsAt} n={marks.lips} /> : null}

      {/* the grip on your tongue (the whole picture takes the finger; this shows where to pull) */}
      {grip && heard ? (
        <g ref={refs?.grip} data-grip transform={`translate(${now[GRIP][0].toFixed(2)},${now[GRIP][1].toFixed(2)})`} style={{ cursor: "grab" }}>
          <circle r="5" fill="transparent" />
          <circle r="2.3" fill="#fff" stroke="var(--ink)" strokeWidth="0.5" />
          <path d="M-0.9,-0.65 L-1.55,0 L-0.9,0.65 M0.9,-0.65 L1.55,0 L0.9,0.65" fill="none" stroke="var(--ink)" strokeWidth="0.42" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ) : null}
    </svg>
  );
}
