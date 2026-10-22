"use client";

/**
 * The caption of 通しで言う: the practice screen's karaoke type (tokens.css .telop karaoke — white,
 * the words not reached yet dimmed), with the parts you make your own underlined in yellow
 * (yellow is "you"). Each word changes state as the clock reaches it; written to the DOM directly.
 */
import { useEffect, useRef } from "react";

export type RunCaptionProps = {
  text: string;
  words: { start: number; end: number }[];
  /** word indices you say your own way */
  swap: Set<number>;
  clock: { current: number | null };
};

export default function RunCaption({ text, words, swap, clock }: RunCaptionProps) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    let last = "";
    const loop = () => {
      const t = clock.current;
      const st = words.map((w) => (t === null ? "idle" : t < w.start - 0.03 ? "todo" : t <= w.end + 0.03 ? "now" : "done"));
      const sig = st.join(",");
      if (sig !== last) {
        last = sig;
        st.forEach((s, i) => {
          const el = refs.current[i];
          if (el && el.dataset.state !== s) el.dataset.state = s;
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [words, clock]);

  return (
    <div className="telop en relative w-full" data-mode="karaoke" style={{ paddingBottom: "0.14em" }}>
      <span className="sr-only">{text}</span>
      <div aria-hidden className="flex flex-wrap" style={{ columnGap: "0.26em" }}>
        {tokens.map((tok, i) => (
          <span
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="telop-word"
            style={{ paddingInline: "0.04em" }}
          >
            <span className="tl tl-a">{tok}</span>
            {swap.has(i) ? <span aria-hidden className="pointer-events-none absolute inset-x-[0.02em] bottom-[0.04em] h-[0.09em] rounded-full bg-(--voice)" /> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
