"use client";

import Link from "next/link";
import { IconClose, IconSound } from "./icons";

export type TopBarProps = {
  backHref: string;
  /** 1-based position of this line in the lesson */
  index: number;
  total: number;
  /** consecutive GREAT-or-better lines; hidden below 2 (a broken combo just disappears) */
  combo?: number;
  /** sound-effect toggle; omitted = not shown (the practice screen keeps the top quiet) */
  muted?: boolean;
  onToggleMute?: () => void;
};

export default function TopBar({ backHref, index, total, combo = 0, muted, onToggleMute }: TopBarProps) {
  return (
    <header className="mx-auto flex h-[60px] w-full max-w-[1080px] items-center gap-2 px-2 md:h-[72px] md:px-4">
      <Link
        href={backHref}
        aria-label="練習をやめて、ホームにもどる"
        className="grid size-11 shrink-0 place-items-center rounded-full"
      >
        <IconClose size={26} />
      </Link>

      <div
        className="flex flex-1 items-center gap-[5px] px-1"
        role="progressbar"
        aria-label="このレッスンの進み具合"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={index}
        aria-valuetext={`${total}文中 ${index}文目`}
      >
        {/* done: filled; now: filled and taller; still to come: faint */}
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className="flex-1 rounded-full"
            style={{
              height: i === index - 1 ? 12 : 8,
              background: "var(--field-ink)",
              opacity: i < index ? 1 : 0.28,
            }}
          />
        ))}
      </div>

      <div className="flex min-w-[76px] justify-end">
        {combo >= 2 ? (
          <span
            key={combo}
            className="anim-pop inline-flex h-8 items-center rounded-full border-[3px] border-(--ink) bg-(--hit) px-3 text-[14px] font-black leading-none text-white"
          >
            {combo}コンボ
          </span>
        ) : null}
      </div>

      {onToggleMute ? (
        <button
          type="button"
          onClick={onToggleMute}
          aria-pressed={muted}
          aria-label={muted ? "効果音をオンにする" : "効果音をオフにする"}
          className="grid size-11 shrink-0 place-items-center rounded-full"
        >
          <IconSound size={24} muted={muted} />
        </button>
      ) : (
        <span className="w-11 shrink-0" aria-hidden />
      )}
    </header>
  );
}
