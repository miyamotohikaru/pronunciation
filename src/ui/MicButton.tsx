"use client";

/**
 * The big mic in the thumb zone. While recording, rings breathe with your input level
 * (read from a ref every frame) so you can see you are being heard, and a thin ring fills up
 * to the moment the take stops by itself (`progress`, also a ref).
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
  /** 0..1 until the take stops by itself (recording only) */
  progress?: { current: number };
};

const R = 52; // the progress ring's radius in its 120 × 120 box
const LEN = 2 * Math.PI * R;

export default function MicButton({ state, level, onPress, label, hint, progress }: MicButtonProps) {
  const ring1 = useRef<HTMLSpanElement>(null);
  const ring2 = useRef<HTMLSpanElement>(null);
  const arc = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (state !== "recording") return;
    let raf = 0;
    let smooth = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const loop = () => {
      const v = level?.current ?? 0;
      smooth += (v - smooth) * 0.35;
      if (arc.current && progress) arc.current.style.strokeDashoffset = String(LEN * (1 - Math.min(1, Math.max(0, progress.current))));
      if (ring1.current && ring2.current) {
        if (reduce) {
          ring1.current.style.opacity = String(0.25 + smooth * 0.6);
          ring2.current.style.opacity = "0";
        } else {
          ring1.current.style.transform = `scale(${1.05 + smooth * 0.16})`;
          ring2.current.style.transform = `scale(${1.08 + smooth * 0.26})`;
          ring1.current.style.opacity = String(0.3 + smooth * 0.5);
          ring2.current.style.opacity = String(0.08 + smooth * 0.18);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, level]);

  // recording is not yellow: yellow means "your voice playing back"
  const face = state === "recording" ? "press-ink" : "";

  return (
    // fixed width: the label can be wider than the button without pushing the side buttons around
    <div className="flex w-[112px] flex-col items-center md:w-[128px]">
      <div className="relative grid size-[96px] place-items-center md:size-[112px]">
        {state === "recording" ? (
          <>
            <span ref={ring2} aria-hidden className="absolute inset-0 rounded-full bg-(--field-ink) will-change-transform" />
            <span ref={ring1} aria-hidden className="absolute inset-0 rounded-full border-[5px] border-(--field-ink) will-change-transform" />
          </>
        ) : null}
        {state === "recording" && progress ? (
          // until it stops by itself
          <svg aria-hidden viewBox="0 0 120 120" className="pointer-events-none absolute -inset-[14px] z-[1] size-[calc(100%+28px)] -rotate-90">
            <circle cx="60" cy="60" r={R} fill="none" stroke="color-mix(in srgb, var(--field-ink) 28%, transparent)" strokeWidth="4" />
            <circle ref={arc} cx="60" cy="60" r={R} fill="none" stroke="var(--paper)" strokeWidth="4" strokeLinecap="round" strokeDasharray={LEN} strokeDashoffset={LEN} />
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
