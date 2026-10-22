"use client";

/**
 * The big mic in the thumb zone. While recording it is the stop button, with one thin ring
 * around it that runs down as the time left before the take stops by itself (`progress`, a ref
 * read every frame). No glow: the lane shows that you are being heard.
 */
import { useEffect, useRef } from "react";
import { IconMic, IconStop } from "./icons";

export type MicState = "idle" | "recording" | "thinking";

export type MicButtonProps = {
  state: MicState;
  /** (no longer drawn: the lane shows your voice) */
  level?: { current: number };
  onPress: () => void;
  label: string;
  hint?: string;
  /** 0..1 until the take stops by itself (recording only) */
  progress?: { current: number };
};

const R = 52; // the progress ring's radius in its 120 × 120 box
const LEN = 2 * Math.PI * R;

export default function MicButton({ state, onPress, label, hint, progress }: MicButtonProps) {
  const arc = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (state !== "recording" || !progress) return;
    let raf = 0;
    const loop = () => {
      // the time left: full at the start, empty when it stops by itself
      if (arc.current) arc.current.style.strokeDashoffset = String(LEN * Math.min(1, Math.max(0, progress.current)));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, progress]);

  // recording is not yellow: yellow means "your voice playing back"
  const face = state === "recording" ? "press-ink" : "";

  return (
    // fixed width: the label can be wider than the button without pushing the side buttons around
    <div className="flex w-[112px] flex-col items-center md:w-[128px]">
      <div className="relative grid size-[96px] place-items-center md:size-[112px]">

        {state === "recording" && progress ? (
          // until it stops by itself
          <svg aria-hidden viewBox="0 0 120 120" className="pointer-events-none absolute -inset-[14px] z-[1] size-[calc(100%+28px)] -rotate-90">
            <circle cx="60" cy="60" r={R} fill="none" stroke="color-mix(in srgb, var(--field-ink) 28%, transparent)" strokeWidth="4" />
            <circle ref={arc} cx="60" cy="60" r={R} fill="none" stroke="var(--paper)" strokeWidth="4" strokeLinecap="round" strokeDasharray={LEN} strokeDashoffset={0} />
          </svg>
        ) : null}
        {state === "thinking" ? (
          <svg aria-hidden viewBox="0 0 120 120" className="anim-spin absolute -inset-[10px] size-[calc(100%+20px)]">
            <circle cx="60" cy="60" r="56" fill="none" stroke="var(--field-deep)" strokeWidth="6" />
            <path d="M60 4a56 56 0 0 1 56 56" fill="none" stroke="var(--paper)" strokeWidth="6" strokeLinecap="round" />
          </svg>
        ) : null}
        <button
          type="button"
          onClick={onPress}
          disabled={state === "thinking"}
          aria-label={state === "recording" ? "録音を止める" : state === "thinking" ? label : "録音して話す"}
          className={`press ${face} relative size-full rounded-full`}
          style={{ ["--edge" as string]: "6px" }}
        >
          {state === "recording" ? <IconStop size={38} /> : <IconMic size={42} />}
        </button>
      </div>
      <p className="mt-4 whitespace-nowrap text-[15px] font-extrabold leading-none" aria-live="polite">
        {label}
      </p>
      {/* always takes its line, so starting a take never changes the page's layout */}
      <p className="mt-2 h-3 whitespace-nowrap text-[12px] font-bold leading-none" style={{ visibility: hint ? "visible" : "hidden" }}>
        {hint ?? "　"}
      </p>
    </div>
  );
}
