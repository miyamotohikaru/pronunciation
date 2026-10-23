/**
 * 自己紹介: the parts of a line you make your own (名前, 出身, 仕事 …), marked the way you would mark
 * a printed script — a yellow highlighter under exactly those words (yellow is "you" in this app).
 */
import { Fragment, useRef, type CSSProperties, type ReactNode } from "react";
import { MarkedWord, useItemMarks, useLinkWraps } from "../marks/Marked";
import type { LineMarks } from "../marks/lineMarks";

export type Swap = { word: string; note: string };

/** [start, end) character ranges of the swaps in the text, in order, never overlapping */
export function swapRanges(text: string, swaps: Swap[]): { a: number; b: number; swap: Swap }[] {
  const out: { a: number; b: number; swap: Swap }[] = [];
  for (const s of swaps) {
    let from = 0;
    while (from <= text.length) {
      const a = text.indexOf(s.word, from);
      if (a < 0) break;
      const b = a + s.word.length;
      if (!out.some((r) => a < r.b && b > r.a)) {
        out.push({ a, b, swap: s });
        break;
      }
      from = a + 1;
    }
  }
  return out.sort((x, y) => x.a - y.a);
}

export const MARKER: CSSProperties = {
  // a highlighter stroke under the lower half of the letters
  backgroundImage: "linear-gradient(transparent 54%, color-mix(in srgb, var(--voice) 78%, transparent) 54%, color-mix(in srgb, var(--voice) 78%, transparent) 94%, transparent 94%)",
  borderRadius: "0.12em",
  paddingInline: "0.06em",
  marginInline: "-0.06em",
  boxDecorationBreak: "clone",
  WebkitBoxDecorationBreak: "clone",
};

/**
 * the line with its swaps highlighted; `label` adds the hidden words for screen readers. With `marks`
 * the words carry the app's ● (strong syllable) and ‿ (running on) too.
 */
export function SwapText({ text, swaps, marks }: { text: string; swaps: Swap[]; marks?: LineMarks | null }) {
  const box = useRef<HTMLSpanElement>(null);
  const tokens = [...text.matchAll(/\S+/g)].map((m) => ({ tok: m[0], a: m.index ?? 0, b: (m.index ?? 0) + m[0].length }));
  const mk = marks && marks.strong.length === tokens.length ? marks : null;
  useLinkWraps(box, mk);
  const ranges = swapRanges(text, swaps);
  if (mk) {
    // the words in order; the ones inside a swap share one highlighter stroke
    const inSwap = (t: { a: number; b: number }) => ranges.findIndex((r) => t.a < r.b && t.b > r.a);
    const out: ReactNode[] = [];
    let i = 0;
    while (i < tokens.length) {
      const ri = inSwap(tokens[i]);
      let j = i;
      while (ri >= 0 && j + 1 < tokens.length && inSwap(tokens[j + 1]) === ri) j++;
      const words: ReactNode[] = [];
      for (let k = i; k <= j; k++) {
        words.push(<MarkedWord key={k} token={tokens[k].tok} strong={mk.strong[k]} link={!!mk.link[k] && k < tokens.length - 1} index={k} />);
        if (k < j) words.push(" ");
      }
      out.push(
        ri >= 0 ? (
          <mark key={i} className="text-inherit" style={{ ...MARKER, color: "inherit", backgroundColor: "transparent" }}>
            {words}
            <span className="sr-only">（ここをあなたのことに）</span>
          </mark>
        ) : (
          <Fragment key={i}>{words}</Fragment>
        ),
      );
      if (j < tokens.length - 1) out.push(" ");
      i = j + 1;
    }
    return (
      <span ref={box} className="mk-lines">
        {out}
      </span>
    );
  }
  if (!ranges.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach((r, k) => {
    if (r.a > at) out.push(text.slice(at, r.a));
    out.push(
      <mark key={k} className="text-inherit" style={{ ...MARKER, color: "inherit", backgroundColor: "transparent" }}>
        {text.slice(r.a, r.b)}
        <span className="sr-only">（ここをあなたのことに）</span>
      </mark>,
    );
    at = r.b;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/** a script line from a list (id and text only): marked once its item is in */
export function SwapLine({ id, text, swaps, ready = true }: { id: string; text: string; swaps: Swap[]; ready?: boolean }) {
  const near = useRef<HTMLSpanElement>(null);
  const marks = useItemMarks(ready ? id : null, near);
  return (
    <span ref={near} className="mk-lines">
      <SwapText text={text} swaps={swaps} marks={marks} />
    </span>
  );
}
