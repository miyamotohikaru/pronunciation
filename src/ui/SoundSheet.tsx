"use client";

/**
 * The sound card as a sheet: the coaching panel (SoundCoach) over a page dimmed enough that the
 * big score underneath doesn't compete. One way to close: the grab handle (drag it down) or the ×
 * (Escape too). Clear of the home bar.
 */
import { useEffect, useRef } from "react";
import SoundCoach, { type SoundCoachProps } from "./SoundCoach";
import { IconClose } from "./icons";

export type RetryState = { state: "idle" | "recording" | "scoring" | "error"; message?: string };

export type SoundSheetProps = SoundCoachProps & { onClose: () => void };

export default function SoundSheet(p: SoundSheetProps) {
  const sheet = useRef<HTMLElement>(null);
  const drag = useRef<{ y0: number; dy: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // drag the handle down to close (transform only)
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y0: e.clientY, dy: 0 };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !sheet.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y0);
    sheet.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onUp = () => {
    if (!drag.current || !sheet.current) return;
    const far = drag.current.dy > 90;
    drag.current = null;
    if (far) p.onClose();
    else sheet.current.style.transform = "";
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center md:items-center" role="presentation">
      <div aria-hidden onClick={p.onClose} className="anim-fade absolute inset-0 bg-[rgba(12,15,51,0.95)]" />
      <section
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="coach-diag"
        className="anim-sheet relative max-h-[92dvh] w-full max-w-[600px] overflow-y-auto rounded-t-[28px] bg-(--paper) px-5 pt-2 transition-transform duration-150 md:rounded-[28px]"
      >
        <div className="flex items-center justify-between">
          <span className="w-11" aria-hidden />
          <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} className="grid h-8 w-24 cursor-grab touch-none place-items-center" aria-hidden>
            <span className="h-[5px] w-10 rounded-full bg-[#d4d7e6]" />
          </div>
          <button ref={closeRef} type="button" onClick={p.onClose} aria-label="閉じる" className="-mr-2 grid size-11 place-items-center rounded-full text-(--ink)">
            <IconClose size={22} />
          </button>
        </div>
        <SoundCoach {...p} retryAt="footer" />
      </section>
    </div>
  );
}
