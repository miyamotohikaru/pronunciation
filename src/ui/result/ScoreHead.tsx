"use client";

/**
 * The top of the result: the total as a whole number — "65" with a small "/100" (no decimals:
 * they read as a bug or as meaningless precision) — a karaoke-machine counter that stays readable
 * while it runs (each digit slides in its own window, ~600 ms, settles with a small spring); the
 * change since the last attempt; the verdict big.
 * PartsRow: the three parts as integers that visibly add up to it (音 /50 + リズム /25 + 抑揚 /25).
 *
 * Per frame: only transforms on five digit strips (no React state, no layout).
 */
import { useEffect, useRef, useState } from "react";
import { parts } from "../score";
import type { Scores } from "../types";

export type ScoreHeadProps = {
  scores: Scores;
  /** start counting (false = show final at once) */
  run: boolean;
  skip: boolean;
  onProgress?: (k: number) => void;
  onDone?: () => void;
  verdict: string;
  /** total of the previous attempt on this line; null on the first */
  previous: number | null;
  /** big celebratory styling (high scores only) */
  celebrate: boolean;
};

const DIGITS = "0123456789";
const DURATION = 600;

/** the total as shown: a whole number */
export const shownTotal = (s: Scores) => Math.round(s.overall);

/** integer parts that add up to the shown total: largest remainders get the leftover points */
function integerParts(s: Scores) {
  const ps = parts(s);
  const floors = ps.map((p) => Math.floor(p.points));
  const target = Math.round(ps.reduce((a, p) => a + p.points, 0));
  let left = target - floors.reduce((a, b) => a + b, 0);
  const order = ps.map((p, i) => [p.points - floors[i], i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i]++;
    left--;
  }
  return ps.map((p, i) => ({ ...p, int: floors[i] }));
}

export default function ScoreHead({ scores, run, skip, onProgress, onDone, verdict, previous, celebrate }: ScoreHeadProps) {
  const total = shownTotal(scores);
  const [done, setDone] = useState(!run);
  const strips = useRef<(HTMLSpanElement | null)[]>([]);
  const cb = useRef({ onProgress, onDone });
  cb.current = { onProgress, onDone };
  const PLACES = [100, 10, 1];

  const show = (v: number, settle: boolean) => {
    const n = Math.round(v);
    PLACES.forEach((p, i) => {
      const el = strips.current[i];
      if (!el) return;
      const d = Math.floor(n / p) % 10;
      // a short slide per step while counting; a spring when it lands
      el.style.transition = settle ? "transform 340ms cubic-bezier(.34,1.56,.64,1)" : "transform 70ms linear";
      el.style.transform = `translateY(${-d * 10}%)`;
    });
  };

  useEffect(() => {
    if (!run) {
      show(total, false);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (skip || reduce) {
      show(total, false);
      setDone(true);
      cb.current.onProgress?.(1);
      cb.current.onDone?.();
      return;
    }
    let raf = 0;
    let lastStep = -1;
    const t0 = performance.now();
    const loop = (now: number) => {
      const k = Math.min(1, (now - t0) / DURATION);
      // ~12 readable steps instead of a blur
      const step = Math.floor(k * 12);
      if (step !== lastStep) {
        lastStep = step;
        show(Math.floor(total * (1 - Math.pow(1 - step / 12, 3))), false);
      }
      cb.current.onProgress?.(k);
      if (k < 1) raf = requestAnimationFrame(loop);
      else {
        show(total, true);
        setDone(true);
        cb.current.onDone?.();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, skip, total]);

  const delta = previous === null ? null : Math.round(total - previous);

  return (
    <section aria-label="点数" className="w-full">
      {/* "65" big, "/100" small at its foot */}
      <div className="flex items-end gap-4">
        <div className="flex items-end leading-none" aria-hidden>
          {total >= 100 ? <Digit refFn={(el) => (strips.current[0] = el)} big /> : null}
          <Digit refFn={(el) => (strips.current[1] = el)} big hidden={total < 10} />
          <Digit refFn={(el) => (strips.current[2] = el)} big />
          <span className="num mb-[16px] ml-[6px] text-[18px] font-bold md:mb-[20px] md:text-[21px]">/100</span>
        </div>
        {delta !== null && done ? (
          <span
            className="anim-pop num mb-[16px] inline-flex h-8 items-center rounded-full bg-(--paper) px-3 text-[15px] font-bold leading-none text-(--ink)"
            aria-label={`前回より ${delta >= 0 ? "+" : ""}${delta}点`}
          >
            {delta > 0 ? `+${delta}` : delta === 0 ? "±0" : `${delta}`}
            <span className="ml-1 text-[11px] font-medium">前回比</span>
          </span>
        ) : null}
      </div>
      <p className={`mt-1 min-h-[40px] font-black leading-tight ${celebrate ? "text-[36px] md:text-[44px]" : "text-[32px] md:text-[40px]"}`} aria-live="polite">
        {done ? verdict : ""}
        <span className="sr-only">{done ? `${total}点。` : ""}</span>
      </p>
    </section>
  );
}

/** the parts as integers that add up to the total, one row (inside 「くわしく」) */
export function PartsRow({ scores }: { scores: Scores }) {
  const ip = integerParts(scores);
  return (
    <ul className="grid grid-cols-3 gap-2" aria-label="内わけ">
      {ip.map((p) => (
        <li key={p.key} className="rounded-[16px] bg-(--paper) px-3 pb-3 pt-[10px] text-(--ink)">
          <span className="block text-[12px] font-medium leading-none">{p.label}</span>
          <span className="num mt-2 flex items-baseline gap-[3px] leading-none">
            <span className="text-[24px] font-bold">{p.int}</span>
            <span className="text-[12px] font-medium opacity-70">/{p.max}</span>
          </span>
          <span aria-hidden className="mt-2 block h-[5px] overflow-hidden rounded-full bg-[#e4e7f5]">
            <span className="block h-full origin-left rounded-full bg-(--ink)" style={{ transform: `scaleX(${p.points / p.max})` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** one digit window with a 0–9 strip; the total's integer digits big (the rounded face), the decimals small */
function Digit({ refFn, big, hidden }: { refFn: (el: HTMLSpanElement | null) => void; big?: boolean; hidden?: boolean }) {
  return (
    <span
      className={`relative inline-block overflow-hidden ${big ? "telop text-[88px] md:text-[116px]" : ""}`}
      style={{ width: big ? "0.64em" : "0.6em", height: big ? "1.16em" : "1.1em", visibility: hidden ? "hidden" : undefined }}
    >
      {/* one text block per window (0–9 on ten lines, one line = one window): few layout objects */}
      <span
        ref={refFn}
        className={`${big ? "tl-a" : ""} absolute inset-x-0 top-0 block whitespace-pre text-center will-change-transform`}
        style={{ lineHeight: big ? "1.16em" : "1.1em", ...(big ? { ["--telop-stroke" as string]: "0.24em" } : {}) }}
      >
        {DIGITS.split("").join("\n")}
      </span>
    </span>
  );
}
