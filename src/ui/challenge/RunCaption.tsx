"use client";

/**
 * The caption of 通しで言う: the practice screen's karaoke type (tokens.css .telop karaoke — white,
 * the words not reached yet dimmed), with the parts you make your own underlined in yellow
 * (yellow is "you"). Each word changes state as the clock reaches it; written to the DOM directly.
 * With `marks`: the app's ● over strong syllables and ‿ where words run on (src/ui/marks).
 */
import { useEffect, useRef } from "react";
import { MarkedWord, useLinkWraps } from "../marks/Marked";
import type { LineMarks } from "../marks/lineMarks";

export type RunCaptionProps = {
  text: string;
  words: { start: number; end: number }[];
  /** word indices you say your own way */
  swap: Set<number>;
  clock: { current: number | null };
  /** the line's marks (● strong syllables, ‿ links) */
  marks?: LineMarks | null;
};

const PAD = 0.04;
const GAP = 0.26;

export default function RunCaption({ text, words, swap, clock, marks }: RunCaptionProps) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const mk = marks && marks.strong.length === tokens.length ? marks : null;
  useLinkWraps(box, mk);

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
    <div className="telop en relative w-full" data-mode="karaoke" style={{ paddingTop: mk ? "0.14em" : undefined, paddingBottom: "0.14em", ["--mk-gap" as string]: `${2 * PAD + GAP}em` }}>
      <span className="sr-only">{text}</span>
      {/* with marks, lines 1.72 em apart (1.14 + 0.58): each ● sits with its own line */}
      <div ref={box} aria-hidden className="flex flex-wrap" style={{ columnGap: `${GAP}em`, rowGap: mk ? "0.58em" : undefined }}>
        {tokens.map((tok, i) => (
          <span
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="telop-word"
            style={{ paddingInline: `${PAD}em` }}
          >
            <span className="tl tl-a">{mk ? <MarkedWord token={tok} strong={mk.strong[i]} link={!!mk.link[i] && i < tokens.length - 1} index={i} /> : tok}</span>
            {swap.has(i) ? <span aria-hidden className="pointer-events-none absolute inset-x-[0.02em] bottom-[0.04em] h-[0.09em] rounded-full bg-(--voice)" /> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
