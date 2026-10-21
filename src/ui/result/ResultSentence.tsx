/**
 * The sentence itself is the diagnosis: one calm line in the Latin face, one colour, and only the
 * letters of a sound that went wrong stand out — in the error colour AND bold with a wavy underline
 * (shape too, so it reads without colour). A flagged word is a button that opens its sound card.
 */
import type { ReactNode } from "react";
import BreakText from "@/components/BreakText";
import type { WordScore } from "../types";
import { mark } from "../score";

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
  const any = flagged.some(Boolean);
  return (
    <section aria-label="あなたの文" className="w-full rounded-[22px] bg-(--paper) px-5 pb-4 pt-4 text-(--ink)">
      <p className="en text-[32px] font-bold leading-[1.3] md:text-[40px]">
        {words.map((w, i) => {
          const tok = tokens[i] ?? w.text;
          const content = renderLetters(tok, w);
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
      <p className="jp mt-2 text-[14px] font-bold leading-snug text-[color-mix(in_srgb,var(--ink)_75%,transparent)]">
        <BreakText text={ja} />
      </p>
      <p className="jp mt-3 flex items-center gap-2 text-[13px] font-bold leading-snug">
        {any ? (
          <>
            <span aria-hidden className="en font-extrabold text-(--miss) underline decoration-wavy decoration-2 underline-offset-4">
              abc
            </span>
            <BreakText text="波線の文字を押すと、◆直し方が出ます。" />
          </>
        ) : (
          <BreakText text="音のずれは、◆見つかりませんでした。" />
        )}
      </p>
    </section>
  );
}

function renderLetters(token: string, w: WordScore) {
  const marks = w.phones.filter((p) => mark(p) === "miss" && p.letters && p.letters[1] > p.letters[0]).map((p) => p.letters!) as [number, number][];
  if (!marks.length) {
    // a word with a miss but no letters for it: mark the whole word
    if (w.phones.some((p) => mark(p) === "miss")) return <Miss>{token}</Miss>;
    return token;
  }
  marks.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach(([a, b], k) => {
    if (a > at) out.push(token.slice(at, a));
    out.push(<Miss key={k}>{token.slice(Math.max(a, at), b)}</Miss>);
    at = Math.max(at, b);
  });
  if (at < token.length) out.push(token.slice(at));
  return out;
}

function Miss({ children }: { children: ReactNode }) {
  return (
    <span className="font-extrabold text-(--miss) underline decoration-(--miss) decoration-wavy decoration-[2.5px] underline-offset-[6px] [text-decoration-skip-ink:none]">
      {children}
    </span>
  );
}
