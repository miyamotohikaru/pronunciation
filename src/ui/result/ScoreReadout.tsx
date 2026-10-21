"use client";

/**
 * DAM-style score: big telop numerals to three decimals, counted up in ~1.2 s (tap skips).
 * The judgement word and the delta vs. your best land when the count stops.
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

export default function ScoreReadout({ value, run, skip, durationMs = 1200, onProgress, onDone, verdict, delta, attempt }: ScoreReadoutProps) {
  const [shown, setShown] = useState(run ? 0 : value);
  const [done, setDone] = useState(!run);
  const cb = useRef({ onProgress, onDone });
  cb.current = { onProgress, onDone };

  useEffect(() => {
    if (!run) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (skip || reduce) {
      setShown(value);
      setDone(true);
      cb.current.onProgress?.(1);
      cb.current.onDone?.();
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const k = Math.min(1, (now - t0) / durationMs);
      setShown(value * easeOut(k));
      cb.current.onProgress?.(k);
      if (k < 1) raf = requestAnimationFrame(loop);
      else {
        setDone(true);
        cb.current.onDone?.();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [run, skip, value, durationMs]);

  const [int, dec] = fmt3(shown).split(".");
  const perfect = done && value >= 95;
  return (
    <div className="flex flex-col">
      <div className="relative flex items-end leading-none" aria-hidden>
        {perfect ? <Burst /> : null}
        <TelopText text={int.padStart(2, " ")} cells className="text-[76px] md:text-[112px]" />
        <TelopText text={`.${dec}`} cells className="mb-[3px] text-[44px] md:mb-[6px] md:text-[64px]" />
        <TelopText text="点" className="mb-[6px] ml-1 text-[28px] md:mb-[10px] md:text-[40px]" />
      </div>
      <div className="mt-3 flex min-h-[34px] flex-wrap items-center gap-x-3 gap-y-2">
        {done ? (
          <>
            <span className="anim-pop jp text-[22px] font-black leading-none md:text-[28px]">{verdict}</span>
            {delta !== null ? (
              <span
                className="anim-pop num inline-flex h-[30px] items-center rounded-full border-[3px] border-(--ink) px-3 text-[15px] font-black leading-none"
                style={{
                  background: delta > 0 ? "var(--voice)" : "var(--paper)",
                  color: "var(--ink)",
                  animationDelay: "120ms",
                }}
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

/** PERFECT (≥ 95): one burst of sparks from the score, once. */
function Burst() {
  const colors = ["var(--hit)", "var(--voice)", "var(--paper)", "var(--j-great)"];
  return (
    <span className="pointer-events-none absolute left-[22%] top-1/2">
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2 + 0.2;
        const r = 70 + (i % 3) * 26;
        return (
          <span
            key={i}
            className="anim-spark absolute rounded-full border-2 border-(--ink)"
            style={
              {
                width: i % 4 === 0 ? 14 : 10,
                height: i % 4 === 0 ? 14 : 10,
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
