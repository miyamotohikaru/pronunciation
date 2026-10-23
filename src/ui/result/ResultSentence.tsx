"use client";

/**
 * The sentence in one line under the score: one calm line in the Latin face, one colour. A wrong
 * word is marked as a whole — a light tag with a 2 px line under it — darker the more it gets in the
 * way of being understood (weights from ./weigh), so the one or two that matter stand out and the
 * rest stay quiet. A marked word is a button that opens its card.
 * The line's own marks (● strong syllables, ‿ where words run on) are there too, quieter than the
 * mistakes (half strength).
 */
import { useRef } from "react";
import type { WordScore } from "../types";
import { MarkedWord, useLinkWraps } from "../marks/Marked";
import type { LineMarks } from "../marks/lineMarks";

export type ResultSentenceProps = {
  text: string;
  words: WordScore[];
  /** per word: how much it gets in the way (0 = fine) */
  weights: number[];
  /** the line's marks (● strong syllables, ‿ links) */
  marks?: LineMarks | null;
  onOpen: (i: number) => void;
  selected?: number | null;
};

const PAD = 0.12; // a marked word's own room (em)

export default function ResultSentence({ text, words, weights, marks, onOpen, selected }: ResultSentenceProps) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const max = Math.max(1e-6, ...weights);
  const mk = marks && marks.strong.length === words.length ? marks : null;
  const box = useRef<HTMLParagraphElement>(null);
  useLinkWraps(box, mk);
  // one line where it fits; a long line just gets smaller first
  const size = text.length > 34 ? "text-[17px] md:text-[22px]" : text.length > 22 ? "text-[20px] md:text-[26px]" : "text-[22px] md:text-[30px]";
  const flagged = (i: number) => (weights[i] ?? 0) > 0;
  return (
    <section aria-label="あなたの文" className="w-full rounded-[18px] bg-(--paper) px-4 pb-3 pt-2 text-(--ink)" style={{ ["--mk-opacity" as string]: 0.5 }}>
      {/* 1.72 em lines: a ● is twice as far from the line above as from its own letters */}
      <p ref={box} className={`en ${size} font-bold leading-[1.72]`}>
        {words.map((w, i) => {
          const tok = tokens[i] ?? w.text;
          const sep = i < words.length - 1 ? " " : "";
          const wt = weights[i] ?? 0;
          const body = mk ? (
            <MarkedWord token={tok} strong={mk.strong[i]} link={!!mk.link[i] && i < words.length - 1} index={i} gap={0.27 + (flagged(i) ? PAD : 0) + (flagged(i + 1) ? PAD : 0)} />
          ) : (
            <span data-word>{tok}</span>
          );
          if (!(wt > 0))
            return (
              <span key={i}>
                {body}
                {sep}
              </span>
            );
          const k = Math.min(1, wt / max); // 0..1: how heavy, against the heaviest on the line
          return (
            <span key={i}>
              <button
                type="button"
                onClick={() => onOpen(i)}
                aria-pressed={selected === i}
                aria-label={`${w.text.replace(/[.,!?]/g, "")} を直す。くわしく見る`}
                className="inline-block rounded-[0.22em] align-baseline"
                style={{
                  paddingInline: `${PAD}em`,
                  background: `color-mix(in srgb, var(--miss) ${Math.round(6 + 16 * k)}%, transparent)`,
                  boxShadow: `inset 0 -2px 0 color-mix(in srgb, var(--miss) ${Math.round(35 + 65 * k)}%, transparent)${selected === i ? ", 0 0 0 2px var(--ink)" : ""}`,
                }}
              >
                {body}
              </button>
              {sep}
            </span>
          );
        })}
      </p>
    </section>
  );
}
