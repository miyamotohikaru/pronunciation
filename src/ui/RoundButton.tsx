"use client";

/** Small pressable circle with a label under it (お手本 / ゆっくり). A ring runs while it plays. */
import type { ReactNode } from "react";

export type RoundButtonProps = {
  icon: ReactNode;
  label: string;
  ariaLabel?: string;
  onPress: () => void;
  /** ms of the audio while playing; null when idle */
  playingMs?: number | null;
  disabled?: boolean;
};

export default function RoundButton({ icon, label, ariaLabel, onPress, playingMs, disabled }: RoundButtonProps) {
  const playing = playingMs != null;
  return (
    <div className="flex w-[84px] flex-col items-center">
      {/* same height as the mic, so every label sits on one line */}
      <div className="grid h-[96px] place-items-center md:h-[112px]">
      <div className="relative size-[64px] md:size-[72px]">
        {playing ? (
          <svg aria-hidden viewBox="0 0 80 80" className="pointer-events-none absolute -inset-[7px] size-[calc(100%+14px)] -rotate-90">
            <circle
              cx="40"
              cy="40"
              r="37"
              fill="none"
              stroke="var(--field-ink)"
              strokeWidth="4"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray="100"
              style={{ animation: `kara-ring ${playingMs}ms linear both` }}
            />
          </svg>
        ) : null}
        <button
          type="button"
          onClick={onPress}
          disabled={disabled}
          aria-label={ariaLabel ?? label}
          aria-pressed={playing}
          className="press relative size-full rounded-full disabled:opacity-35"
        >
          {icon}
        </button>
      </div>
      </div>
      <span className="mt-4 text-[15px] font-extrabold leading-none">{label}</span>
    </div>
  );
}
