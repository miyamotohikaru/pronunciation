"use client";

/**
 * DAM-style score: big telop numerals to three decimals, rolled up like a slot machine in ~1.2 s
 * (tap skips). The digits are vertical strips moved with transforms from one rAF loop — no React
 * state and no layout work per frame. The judgement word and the delta land when it stops.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import TelopText from "../TelopText";
import { fmt3 } from "../score";

export type ScoreReadoutProps = {
  value: number;
  /** start counting */
  run: boolean;
  /** jump to the end now */
  skip: boolean;
  durationMs?: number;
  onProgress?: (k: number) => void;
  onDone?: () => void;
  verdict: string;
  /** vs. previous best; null on the first try */
  delta: number | null;
  attempt: number;
};

const easeOut = (k: number) => 1 - Math.pow(1 - k, 4);
const STRIP = "0123456789";

export default function ScoreReadout({ value, run, skip, durationMs = 1200, onProgress, onDone, verdict, delta, attempt }: ScoreReadoutProps) {
  const [done, setDone] = useState(!run);
  const cb = useRef({ onProgress, onDone });
  cb.current = { onProgress, onDone };
  const strips = useRef<(HTMLSpanElement | null)[]>([]);
  // places: tens, ones, tenths, hundredths, thousandths
  const PLACES = [10, 1, 0.1, 0.01, 0.001];

  const paint = (v: number, smooth: boolean) => {
    PLACES.forEach((p, i) => {
      const el = strips.current[i];
      if (!el) return;
      const x = v / p;
      // continuous for a rolling look while counting, exact digits at rest
      const d = smooth ? x % 10 : Math.floor(x + 1e-6) % 10;
      el.style.transform = `translateY(${-d * 10}%)`;
    });
  };

  useEffect(() => {
    if (!run) {
      paint(value, false);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (skip || reduce) {
      paint(value, false);
      setDone(true);
      cb.current.onProgress?.(1);
      cb.current.onDone?.();
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const k = Math.min(1, (now - t0) / durationMs);
      paint(value * easeOut(k), k < 1);
      cb.current.onProgress?.(k);
      if (k < 1) raf = requestAnimationFrame(loop);
      else {
        paint(value, false);
        setDone(true);
        cb.current.onDone?.();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, skip, value, durationMs]);

  const perfect = done && value >= 95;
  const big = "text-[76px] md:text-[112px]";
  const small = "text-[44px] md:text-[64px]";
  return (
    <div className="flex flex-col">
      <div className="relative flex items-end leading-none" aria-hidden>
        {perfect ? <Burst /> : null}
        <Digit refFn={(el) => (strips.current[0] = el)} className={big} hideZero={value < 10} />
        <Digit refFn={(el) => (strips.current[1] = el)} className={big} />
        <TelopText text="." className={`${small} mb-[3px] md:mb-[6px]`} />
        <Digit refFn={(el) => (strips.current[2] = el)} className={`${small} mb-[3px] md:mb-[6px]`} />
        <Digit refFn={(el) => (strips.current[3] = el)} className={`${small} mb-[3px] md:mb-[6px]`} />
        <Digit refFn={(el) => (strips.current[4] = el)} className={`${small} mb-[3px] md:mb-[6px]`} />
        <TelopText text="点" className="mb-[6px] ml-1 text-[28px] md:mb-[10px] md:text-[40px]" />
      </div>
      <div className="mt-3 flex min-h-[34px] flex-wrap items-center gap-x-3 gap-y-2">
        {done ? (
          <>
            {perfect ? (
              <span className="anim-pop leading-none">
                <TelopText text={verdict} fill="var(--hit)" className="text-[28px] md:text-[36px]" />
              </span>
            ) : (
              <span className="anim-pop jp text-[22px] font-black leading-none md:text-[28px]">{verdict}</span>
            )}
            {delta !== null ? (
              <span
                className="anim-pop num inline-flex h-[30px] items-center rounded-full border-[3px] border-(--ink) px-3 text-[15px] font-black leading-none"
                style={{ background: delta > 0 ? "var(--voice)" : "var(--paper)", color: "var(--ink)", animationDelay: "120ms" }}
              >
                {delta > 0 ? `+${fmt3(delta)} ベスト更新` : `ベストまで ${fmt3(-delta)}`}
              </span>
            ) : null}
          </>
        ) : null}
        <span className="ml-auto text-[13px] font-extrabold leading-none">{attempt}回目</span>
      </div>
      <p className="sr-only" aria-live="polite">
        {done ? `${fmt3(value)}点。${verdict}。` : ""}
      </p>
    </div>
  );
}

/** One odometer digit: a 0–9 strip in a 1-digit window. The window is tall enough for the outline. */
function Digit({ refFn, className, hideZero }: { refFn: (el: HTMLSpanElement | null) => void; className: string; hideZero?: boolean }) {
  return (
    <span className={`telop relative inline-block overflow-hidden ${className}`} style={{ width: "0.66em", height: "1.18em", visibility: hideZero ? "hidden" : undefined }}>
      <span ref={refFn} className="absolute inset-x-0 top-0 flex flex-col items-center will-change-transform" style={{ height: "1000%" }}>
        {STRIP.split("").map((c) => (
          <span key={c} className="tl-a flex flex-1 items-center justify-center" style={{ ["--telop-stroke" as string]: "0.25em" }}>
            {c}
          </span>
        ))}
      </span>
    </span>
  );
}

/** PERFECT (≥ 95): one burst of sparks from the score, once. */
function Burst() {
  const colors = ["var(--hit)", "var(--voice)", "var(--paper)", "var(--j-great)"];
  return (
    <span className="pointer-events-none absolute left-[22%] top-1/2">
      {Array.from({ length: 20 }, (_, i) => {
        const a = (i / 20) * Math.PI * 2 + 0.2;
        const r = 90 + (i % 3) * 34;
        const size = i % 4 === 0 ? 20 : i % 2 ? 12 : 15;
        return (
          <span
            key={i}
            className="anim-spark absolute -ml-2 -mt-2 rounded-full border-[3px] border-(--ink)"
            style={
              {
                width: size,
                height: size,
                background: colors[i % colors.length],
                "--dx": `${Math.cos(a) * r}px`,
                "--dy": `${Math.sin(a) * r * 0.7}px`,
                animationDelay: `${(i % 4) * 30}ms`,
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}
