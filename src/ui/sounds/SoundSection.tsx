"use client";

/**
 * The mouth on a sound's page: the app's professionally drawn mid-sagittal section (src/ui/mouth —
 * Wright & McCloy, CC0), with one tongue only, the model's, in its blue (this page is about the
 * sound, not about you, so there is no amber "your recording" here). Where it must or must not
 * touch: one mark. When the other word of a minimal pair plays, the tongue, jaw and lip move to that
 * sound and back; a diphthong shows its glide (start → end) when its words play or on 動きを見る.
 * Drawn from refs while it moves (no React render per frame).
 */
import { useEffect, useRef } from "react";
import { SAGITTAL_STATIC } from "../mouth/sagittal-data";
import { blend, closedPath, outline, tipOf, type Pt, type ShapeKey } from "../mouth/geometry";

const VIEW = { x: 84, y: 100, w: 92, h: 100 };
const GREY = "#eceef4";
const LINE = "#8f95ad";

/** the one contact mark of a sound (as the sound card draws it): must touch ●, must not ✕ */
function contactFor(target: ShapeKey): { kind: "do" | "dont"; at: Pt; label: string } | null {
  const tip = (k: ShapeKey) => tipOf(outline(k));
  switch (target) {
    case "r":
      return { kind: "dont", at: tip("t"), label: "付けない" };
    case "t":
      return { kind: "do", at: tip("t"), label: "付ける" };
    case "th":
      return { kind: "do", at: tip("th"), label: "歯の間" };
    case "s":
    case "sh":
      return { kind: "dont", at: tip("t"), label: "付けない" };
    case "f":
      return { kind: "do", at: [157.4, 141.6], label: "唇に歯" };
    default:
      return null;
  }
}

export type SoundSectionProps = {
  target: ShapeKey;
  /** the shape it moves to: the pair's other sound, or a diphthong's end */
  other: ShapeKey | null;
  /** 0 = this sound … 1 = the other (eased) */
  pos: number;
  className?: string;
  label: string;
};

export default function SoundSection({ target, other, pos, className, label }: SoundSectionProps) {
  const edge = useRef<SVGPathElement>(null);
  const body = useRef<SVGPathElement>(null);
  const mark = useRef<SVGGElement>(null);
  const at = useRef(pos);
  const raf = useRef(0);

  useEffect(() => {
    const a = outline(target);
    const b = other ? outline(other) : null;
    const draw = (x: number) => {
      const d = closedPath(b ? blend(a, b, x) : a);
      edge.current?.setAttribute("d", d);
      body.current?.setAttribute("d", d);
      if (mark.current) mark.current.style.opacity = x < 0.35 ? "1" : "0";
    };
    const from = at.current;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === pos) {
      at.current = pos;
      draw(pos);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 420);
      at.current = from + (pos - from) * (1 - Math.pow(1 - k, 3));
      draw(at.current);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [pos, target, other]);

  const d0 = closedPath(other ? blend(outline(target), outline(other), pos) : outline(target));
  const contact = contactFor(target);
  return (
    <svg viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} className={className} role="img" aria-label={label}>
      <defs>
        {/* the model's tongue in blue, fading out below so the chin and neck stay plain */}
        <linearGradient id="ss-fade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.5" stopColor="#fff" />
          <stop offset="0.72" stopColor="#000" />
        </linearGradient>
        <mask id="ss-mask" maskUnits="userSpaceOnUse" x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h}>
          <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} fill="url(#ss-fade)" />
        </mask>
      </defs>
      {/* the parts that never move */}
      <path d={SAGITTAL_STATIC.path9} fill={GREY} stroke={LINE} strokeWidth="0.35" />
      <path d={SAGITTAL_STATIC.path7} fill={GREY} stroke={LINE} strokeWidth="0.35" />
      <path d={SAGITTAL_STATIC.path13} fill={GREY} stroke={LINE} strokeWidth="0.35" />
      {/* tongue, jaw and lower lip */}
      <path ref={edge} d={d0} fill={GREY} stroke="var(--guide-ink)" strokeWidth="0.45" />
      <path ref={body} d={d0} fill="color-mix(in srgb, var(--guide) 62%, white)" fillOpacity="0.95" mask="url(#ss-mask)" />
      {contact ? (
        <g ref={mark} style={{ opacity: pos < 0.35 ? 1 : 0, transition: "opacity 140ms" }}>
          {contact.kind === "do" ? (
            <circle cx={contact.at[0]} cy={contact.at[1]} r="1.9" fill="var(--guide-ink)" stroke="#fff" strokeWidth="0.6" />
          ) : (
            <path
              d={`M${contact.at[0] - 1.8},${contact.at[1] - 1.8} L${contact.at[0] + 1.8},${contact.at[1] + 1.8} M${contact.at[0] + 1.8},${contact.at[1] - 1.8} L${contact.at[0] - 1.8},${contact.at[1] + 1.8}`}
              stroke="var(--miss)"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          )}
          <text x={contact.at[0] - 5.5} y={contact.at[1] - 7} fontSize="4.4" fontWeight="700" textAnchor="end" fill={contact.kind === "do" ? "var(--guide-ink)" : "var(--miss)"} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" paintOrder="stroke">
            {contact.label}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
