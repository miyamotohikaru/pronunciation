/**
 * 自己紹介: the parts of a line you make your own (名前, 出身, 仕事 …), marked the way you would mark
 * a printed script — a yellow highlighter under exactly those words (yellow is "you" in this app).
 */
import type { CSSProperties, ReactNode } from "react";

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

/** the line with its swaps highlighted; `label` adds the hidden words for screen readers */
export function SwapText({ text, swaps }: { text: string; swaps: Swap[] }) {
  const ranges = swapRanges(text, swaps);
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
