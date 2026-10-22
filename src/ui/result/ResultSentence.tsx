"use client";

/**
 * The sentence in one line under the score: one calm line in the Latin face, one colour, and only
 * the letters of a sound that went wrong stand out — in the error colour with a wavy line under
 * them (shape too, so it reads without colour). A flagged word is a button that opens its card.
 */
import type { WordScore } from "../types";
import { mark } from "../score";
import { marked } from "./wavy";

export type ResultSentenceProps = {
  text: string;
  words: WordScore[];
  onOpen: (i: number) => void;
  selected?: number | null;
};

export default function ResultSentence({ text, words, onOpen, selected }: ResultSentenceProps) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const flagged = words.map((w) => w.phones.some((p) => mark(p) === "miss"));
  // one line where it fits; a long line just gets smaller first
  const size = text.length > 34 ? "text-[17px] md:text-[22px]" : text.length > 22 ? "text-[20px] md:text-[26px]" : "text-[24px] md:text-[30px]";
  return (
    <section aria-label="あなたの文" className="w-full rounded-[18px] bg-(--paper) px-4 pb-3 pt-2 text-(--ink)">
      <p className={`en ${size} font-bold leading-[1.45]`}>
        {words.map((w, i) => {
          const tok = tokens[i] ?? w.text;
          const content = <span data-word>{marked(tok, w)}</span>;
          const sep = i < words.length - 1 ? " " : "";
          if (!flagged[i])
            return (
              <span key={i}>
                {content}
                {sep}
              </span>
            );
          const worst = [...w.phones].filter((p) => mark(p) === "miss").map((p) => p.letters ? tok.slice(p.letters[0], p.letters[1]) : "").filter(Boolean).join(" と ");
          return (
            <span key={i}>
              <button
                type="button"
                onClick={() => onOpen(i)}
                aria-pressed={selected === i}
                aria-label={`${w.text.replace(/[.,!?]/g, "")}：${worst || "音"} を直す。くわしく見る`}
                className="-mx-1 inline-block rounded-[10px] px-1 py-1 align-baseline hover:bg-[#f2f3fa]"
              >
                {content}
              </button>
              {sep}
            </span>
          );
        })}
      </p>
    </section>
  );
}
