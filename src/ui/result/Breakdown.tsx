"use client";

/**
 * The total, taken apart (JOYSOUND model): each part's points out of its share of 100,
 * track length proportional to the share, and the sum written out so nothing is opaque.
 */
import { useEffect, useState } from "react";
import type { Scores } from "../types";
import { fmt3, parts, total } from "../score";

export type BreakdownProps = {
  scores: Scores;
  /** fill the bars (animated unless reduced motion) */
  run: boolean;
};

export default function Breakdown({ scores, run }: BreakdownProps) {
  const ps = parts(scores);
  const maxShare = Math.max(...ps.map((p) => p.max));
  const [filled, setFilled] = useState(!run);
  useEffect(() => {
    if (!run) return;
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, [run]);

  return (
    <section aria-label="点数の内わけ" className="w-full">
      <ul className="flex flex-col gap-[10px]">
        {ps.map((p, i) => (
          <li key={p.key} className="grid grid-cols-[52px_1fr_auto] items-center gap-3">
            <span className="text-[15px] font-black leading-none">{p.label}</span>
            <span className="relative h-[14px]" style={{ width: `${(p.max / maxShare) * 100}%` }} aria-hidden>
              <span className="absolute inset-0 rounded-full bg-(--field-deep)" />
              <span
                className="absolute inset-y-0 left-0 rounded-full border-2 border-(--ink) bg-(--paper)"
                style={{
                  width: filled ? `${(p.points / p.max) * 100}%` : "0%",
                  transition: `width 760ms cubic-bezier(.2,.8,.2,1) ${180 + i * 130}ms`,
                }}
              />
            </span>
            <span className="num text-right text-[15px] font-black leading-none">
              {fmt3(p.points)}
              <span className="ml-[2px] text-[12px] font-extrabold">/{p.max}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="num mt-3 flex flex-wrap items-baseline justify-end gap-x-[6px] border-t-2 border-(--field-deep) pt-[10px] text-[13px] font-extrabold leading-none">
        {ps.map((p, i) => (
          <span key={p.key}>
            {i ? "+ " : ""}
            {fmt3(p.points)}
          </span>
        ))}
        <span className="font-black">= {fmt3(total(scores))}</span>
      </p>
    </section>
  );
}
