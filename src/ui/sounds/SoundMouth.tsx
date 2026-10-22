"use client";

/**
 * The mouth for /sounds/r and /sounds/l: the same cut-away section as the sound card (lips, front
 * teeth, the ridge behind them, the tip of the tongue), with one tongue only — the model's, in
 * its cyan — because this page is about the sound, not about you. When the other word of a pair
 * plays (right ⇄ light), the tongue moves to that sound and back; where it touches the ridge a ●.
 * The tongue's geometry is MouthSection's own (tongueD / touches), so both drawings agree.
 */
import { useEffect, useRef } from "react";
import { RIDGE, tipAt, tongueD, touches } from "../MouthSection";

export type SoundMouthProps = {
  /** this page's sound */
  target: "r" | "l";
  /** 0 = this sound … 1 = the other one (animated) */
  pos: number;
  className?: string;
};

const INK = "var(--ink)";

export default function SoundMouth({ target, pos, className }: SoundMouthProps) {
  const body = useRef<SVGPathElement>(null);
  const line = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const tipLabel = useRef<SVGGElement>(null);
  const at = useRef(pos);
  const raf = useRef(0);

  // ease to the new position (the drawing moves; React does not re-render per frame)
  useEffect(() => {
    const draw = (x: number) => {
      const d = tongueD(target, x);
      body.current?.setAttribute("d", d.body);
      line.current?.setAttribute("d", d.line);
      if (dot.current) dot.current.style.opacity = touches(target, x) ? "1" : "0";
      const [tx, ty] = tipAt(target, x);
      tipLabel.current?.setAttribute("transform", `translate(${tx.toFixed(1)},${ty.toFixed(1)})`);
    };
    const from = at.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from === pos) {
      at.current = pos;
      draw(pos);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 380);
      const e = 1 - Math.pow(1 - k, 3);
      at.current = from + (pos - from) * e;
      draw(at.current);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [pos, target]);

  const d0 = tongueD(target, pos);
  const touching = touches(target, pos);
  const [tx, ty] = tipAt(target, pos);
  return (
    <svg viewBox="0 36 168 132" className={className} role="img" aria-label={target === "r" ? "口の断面。r の舌先は、どこにも付きません" : "口の断面。l の舌先は、上の歯の付け根の歯ぐきに付きます"}>
      <defs>
        <clipPath id="sm-mouth">
          <path d="M62,70 C66,60 74,56 84,57 C96,58 104,52 120,46 C160,32 230,30 320,40 L320,214 L40,214 L40,170 C52,176 58,172 62,170 Z" />
        </clipPath>
      </defs>
      <path d="M62,70 C66,60 74,56 84,57 C96,58 104,52 120,46 C160,32 230,30 320,40 L320,206 C280,208 230,208 180,204 C120,198 80,184 62,170 Z" fill="#f1f3fa" />
      <g clipPath="url(#sm-mouth)">
        <path ref={body} d={d0.body} fill="color-mix(in srgb, var(--guide) 55%, white)" />
        <path ref={line} d={d0.line} fill="none" stroke="var(--guide-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <path d="M62,70 C66,60 74,56 84,57 C96,58 104,52 120,46 C160,32 230,30 320,40" fill="none" stroke={INK} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M62,170 C80,184 120,198 180,204" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" opacity=".5" />
      <path d="M0,50 C18,46 34,50 44,60 C49,64 49,73 45,78 C34,85 16,83 0,82 Z" fill="#ffffff" />
      <path d="M0,50 C18,46 34,50 44,60 C49,64 49,73 45,78 C34,85 16,83 0,82" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M0,158 C16,154 34,150 44,141 C49,137 49,128 45,123 C34,117 16,119 0,122 Z" fill="#ffffff" />
      <path d="M0,158 C16,154 34,150 44,141 C49,137 49,128 45,123 C34,117 16,119 0,122" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M47,63 C53,61 60,63 62,70 L60,108 C58,115 51,116 48,111 L44,74 C44,69 44,65 47,63 Z" fill="#ffffff" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M48,168 C53,170 59,169 61,164 L63,126 C61,119 54,117 50,121 L46,160 C46,164 46,167 48,168 Z" fill="#ffffff" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
      <circle ref={dot} cx={RIDGE[0]} cy={RIDGE[1] - 1} r="3.4" fill={INK} style={{ opacity: touching ? 1 : 0, transition: "opacity 120ms" }} />
      {/* the tip of the tongue, named where it is (it moves with the tongue) */}
      <g ref={tipLabel} transform={`translate(${tx},${ty})`} aria-hidden>
        <path d="M2,6 C8,14 14,18 22,20" fill="none" stroke="var(--guide-ink)" strokeWidth="1" strokeLinecap="round" />
        <text x="24" y="23" fontSize="7.5" fontWeight="700" fill="var(--guide-ink)">
          舌先
        </text>
      </g>
      {/* where the tip goes: the ridge, named once */}
      <g aria-hidden>
        <path d={`M${RIDGE[0] + 4},${RIDGE[1] - 6} C${RIDGE[0] + 14},${RIDGE[1] - 20} ${RIDGE[0] + 24},${RIDGE[1] - 24} ${RIDGE[0] + 34},${RIDGE[1] - 25}`} fill="none" stroke={INK} strokeWidth="1" strokeLinecap="round" opacity=".55" />
        <text x={RIDGE[0] + 37} y={RIDGE[1] - 22.5} fontSize="7.5" fontWeight="600" fill={INK} opacity=".75">
          歯ぐき
        </text>
      </g>
    </svg>
  );
}
