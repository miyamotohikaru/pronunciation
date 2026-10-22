"use client";

/**
 * The sentence itself is the diagnosis: one calm line in the Latin face, one colour, and only the
 * letters of a sound that went wrong stand out — in the error colour with a wavy line under them
 * (shape too, so it reads without colour). A flagged word is a button that opens its sound card.
 */
import { useRef } from "react";
import BreakText from "@/components/BreakText";
import type { WordScore } from "../types";
import { mark } from "../score";
import { marked, useFitWaves } from "./wavy";

export type ResultSentenceProps = {
  text: string;
  ja: string;
  words: WordScore[];
  onOpen: (i: number) => void;
  selected?: number | null;
};

export default function ResultSentence({ text, ja, words, onOpen, selected }: ResultSentenceProps) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const flagged = words.map((w) => w.phones.some((p) => mark(p) === "miss"));
  const count = flagged.filter(Boolean).length;
  const line = useRef<HTMLParagraphElement>(null);
  useFitWaves(line, words);
  return (
    <section aria-label="あなたの文" className="w-full rounded-[22px] bg-(--paper) px-5 pb-4 pt-4 text-(--ink)">
      <p ref={line} className="en text-[28px] font-bold leading-[1.35] md:text-[36px]">
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
      <p className="jp mt-2 text-[14px] font-medium leading-snug text-[color-mix(in_srgb,var(--ink)_75%,transparent)]">
        <BreakText text={ja} />
      </p>
      {count !== 1 ? (
        <p className="jp mt-2 text-[13px] font-medium leading-snug">
          <BreakText text={count > 1 ? "ほかの波線の文字も、押すと直し方が出ます。" : "音のずれは、見つかりませんでした。"} />
        </p>
      ) : null}
    </section>
  );
}
