"use client";

/**
 * The top of the result: the total, big, as a karaoke-machine counter that stays readable while it
 * runs (each digit slides in its own window, ~600 ms, settles with a small spring); the decimals
 * small and quiet; the change since the last attempt; and the three parts as integers in one row
 * that visibly add up to the total (音 /50 + リズム /25 + 抑揚 /25).
 *
 * Per frame: only transforms on five digit strips (no React state, no layout).
 */
import { useEffect, useRef, useState } from "react";
import TelopText from "../TelopText";
import { fmt3, parts } from "../score";
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

/** integer parts that add up to floor(total): largest remainders get the leftover points */
function integerParts(s: Scores) {
  const ps = parts(s);
  const floors = ps.map((p) => Math.floor(p.points));
  const target = Math.floor(ps.reduce((a, p) => a + p.points, 0) + 1e-9);
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
  const total = scores.overall;
  const [done, setDone] = useState(!run);
  const strips = useRef<(HTMLSpanElement | null)[]>([]);
  const cb = useRef({ onProgress, onDone });
  cb.current = { onProgress, onDone };
  const PLACES = [10, 1, 0.1, 0.01, 0.001];

  const show = (v: number, settle: boolean) => {
    PLACES.forEach((p, i) => {
      const el = strips.current[i];
      if (!el) return;
      const d = Math.floor(v / p + 1e-6) % 10;
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
        show(total * (1 - Math.pow(1 - step / 12, 3)), false);
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

  const ip = integerParts(scores);
  const delta = previous === null ? null : Math.round(total - previous);

  return (
    <section aria-label="点数" className="w-full">
      <div className="flex items-end gap-3">
        <div className="flex items-end leading-none" aria-hidden>
          <Digit refFn={(el) => (strips.current[0] = el)} big hidden={total < 10} />
          <Digit refFn={(el) => (strips.current[1] = el)} big />
          <span className="mb-[0.18em] ml-[2px] text-[22px] font-black text-(--field-ink) opacity-60 md:text-[30px]">.</span>
          <Digit refFn={(el) => (strips.current[2] = el)} />
          <Digit refFn={(el) => (strips.current[3] = el)} />
          <Digit refFn={(el) => (strips.current[4] = el)} />
          <span className="mb-[0.3em] ml-1 text-[22px] font-black md:text-[28px]">点</span>
        </div>
        <div className="mb-2 flex flex-col items-start gap-2">
          {delta !== null && done ? (
            <span
              className="anim-pop num inline-flex h-8 items-center rounded-full px-3 text-[15px] font-black leading-none"
              style={{ background: delta > 0 ? "var(--voice)" : "var(--paper)", color: "var(--ink)" }}
              aria-label={`前回より ${delta >= 0 ? "+" : ""}${delta}点`}
            >
              {delta > 0 ? `+${delta}` : delta === 0 ? "±0" : `${delta}`}
              <span className="ml-1 text-[11px] font-extrabold">前回比</span>
            </span>
          ) : null}
        </div>
      </div>
      <p className="mt-2 min-h-[28px] text-[20px] font-black leading-none md:text-[24px]" aria-live="polite">
        {done ? (celebrate ? <TelopText text={verdict} fill="var(--voice)" className="text-[26px] md:text-[32px]" /> : verdict) : ""}
        <span className="sr-only">{done ? `${fmt3(total)}点。` : ""}</span>
      </p>

      {/* the parts: integers that add up, one row, above the fold */}
      <ul className="mt-4 grid grid-cols-3 gap-2" aria-label="内わけ">
        {ip.map((p) => (
          <li key={p.key} className="rounded-[16px] bg-(--paper) px-3 pb-3 pt-[10px] text-(--ink)">
            <span className="block text-[12px] font-bold leading-none opacity-75">{p.label}</span>
            <span className="num mt-2 flex items-baseline gap-[3px] leading-none">
              <span className="text-[26px] font-black">{p.int}</span>
              <span className="text-[12px] font-bold opacity-60">/{p.max}</span>
            </span>
            <span aria-hidden className="mt-2 block h-[5px] overflow-hidden rounded-full bg-[#e4e7f5]">
              <span className="block h-full origin-left rounded-full bg-(--ink) transition-transform duration-500" style={{ transform: `scaleX(${done ? p.points / p.max : 0})` }} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** one digit window with a 0–9 strip; the total's integer digits big (sticker), the decimals small and quiet */
function Digit({ refFn, big, hidden }: { refFn: (el: HTMLSpanElement | null) => void; big?: boolean; hidden?: boolean }) {
  return (
    <span
      className={`relative inline-block overflow-hidden ${big ? "telop text-[84px] md:text-[112px]" : "num text-[26px] font-black text-(--field-ink) opacity-60 md:text-[34px]"}`}
      style={{ width: big ? "0.64em" : "0.62em", height: big ? "1.16em" : "1.2em", visibility: hidden ? "hidden" : undefined, marginBottom: big ? 0 : "0.12em" }}
    >
      <span ref={refFn} className="absolute inset-x-0 top-0 flex flex-col items-center will-change-transform" style={{ height: "1000%" }}>
        {DIGITS.split("").map((c) => (
          <span key={c} className={`${big ? "tl-a" : ""} flex flex-1 items-center justify-center`} style={big ? { ["--telop-stroke" as string]: "0.24em" } : undefined}>
            {c}
          </span>
        ))}
      </span>
    </span>
  );
}
