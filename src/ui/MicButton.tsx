"use client";

/**
 * The big mic in the thumb zone. While recording, rings breathe with your input level
 * (read from a ref every frame) so you can see you are being heard.
 */
import { useEffect, useRef } from "react";
import { IconMic, IconStop } from "./icons";

export type MicState = "idle" | "recording" | "thinking";

export type MicButtonProps = {
  state: MicState;
  /** 0..1, updated by the recorder (~60 fps) */
  level?: { current: number };
  onPress: () => void;
  label: string;
  hint?: string;
};

export default function MicButton({ state, level, onPress, label, hint }: MicButtonProps) {
  const ring1 = useRef<HTMLSpanElement>(null);
  const ring2 = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (state !== "recording") return;
    let raf = 0;
    let smooth = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const loop = () => {
      const v = level?.current ?? 0;
      smooth += (v - smooth) * 0.35;
      if (ring1.current && ring2.current) {
        if (reduce) {
          ring1.current.style.opacity = String(0.25 + smooth * 0.6);
          ring2.current.style.opacity = "0";
        } else {
          ring1.current.style.transform = `scale(${1.06 + smooth * 0.34})`;
          ring2.current.style.transform = `scale(${1.12 + smooth * 0.72})`;
          ring1.current.style.opacity = String(0.35 + smooth * 0.5);
          ring2.current.style.opacity = String(0.12 + smooth * 0.3);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, level]);

  const face = state === "recording" ? "press-voice" : "";

  return (
    <div className="flex flex-col items-center">
      <div className="relative grid size-[96px] place-items-center md:size-[112px]">
        {state === "recording" ? (
          <>
            <span ref={ring2} aria-hidden className="absolute inset-0 rounded-full bg-(--voice) will-change-transform" />
            <span ref={ring1} aria-hidden className="absolute inset-0 rounded-full border-[6px] border-(--voice) will-change-transform" />
          </>
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
      {hint ? <p className="mt-2 whitespace-nowrap text-[12px] font-bold leading-none">{hint}</p> : null}
    </div>
  );
}
