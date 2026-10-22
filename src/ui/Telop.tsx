"use client";

/**
 * The English line as a Japanese karaoke telop: white fill, thick navy outline,
 * wiping to the unit's colour as the model sings it. Two lines stagger like a karaoke
 * caption (first line from the left, second line to the right).
 *
 * result mode: each word fills with its judgement colour (left → right, driven by `reveal`),
 * and every sound gets a mark under its own letters: ● hit / ▲ near / ▬ miss (an underline bar)
 * — shape first, colour second, so it reads in greyscale. Words become buttons.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Clock } from "./lane/PitchLane";
import type { PhoneScore, WordScore, WordSpan } from "./types";
import { JUDGEMENT_LABEL, JUDGEMENT_VAR, judge, mark, type Mark } from "./score";
import { heardLine } from "./copy";

export type TelopProps = {
  /** the line as shown, punctuation included */
  text: string;
  /** timing of each word on the clock's timeline */
  words: WordSpan[];
  mode: "karaoke" | "result";
  clock?: Clock;
  results?: WordScore[];
  /** 0..1 progress of the colour-in after a take */
  reveal?: { current: number };
  selected?: number | null;
  onSelect?: (i: number) => void;
  className?: string;
  /** karaoke: per word 0..1, how far it is painted gold — your voice in the band, left to right */
  hits?: { current: number[] };
};

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

function Telop({ text, words, mode, clock, results, reveal, selected, onSelect, className, hits }: TelopProps) {
  const display = text.split(/\s+/).filter(Boolean);
  const tokens = words.map((w, i) => display[i] ?? w.text);
  const boxRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<(HTMLElement | null)[]>([]);
  const [lines, setLines] = useState<number[][] | null>(null);

  // --- stagger: measure words, split into balanced lines
  useIso(() => {
    const box = boxRef.current;
    const m = measureRef.current;
    if (!box || !m) return;
    const layout = () => {
      const W = box.clientWidth;
      const spans = Array.from(m.children) as HTMLElement[];
      const space = spans[spans.length - 1]?.getBoundingClientRect().width ?? 0;
      const ws = spans.slice(0, -1).map((s) => s.getBoundingClientRect().width);
      const width = (a: number, b: number) => ws.slice(a, b).reduce((x, y) => x + y, 0) + space * Math.max(0, b - a - 1);
      const n = ws.length;
      let next: number[][];
      if (width(0, n) <= W) next = [Array.from({ length: n }, (_, i) => i)];
      else {
        let best = -1;
        let bestMax = Infinity;
        for (let k = 1; k < n; k++) {
          const mx = Math.max(width(0, k), width(k, n));
          if (width(0, k) <= W && width(k, n) <= W && mx < bestMax) {
            bestMax = mx;
            best = k;
          }
        }
        if (best > 0) next = [Array.from({ length: best }, (_, i) => i), Array.from({ length: n - best }, (_, i) => i + best)];
        else {
          next = [];
          let cur: number[] = [];
          for (let i = 0; i < n; i++) {
            const trial = [...cur, i];
            if (cur.length && width(trial[0], i + 1) > W) {
              next.push(cur);
              cur = [i];
            } else cur = trial;
          }
          if (cur.length) next.push(cur);
        }
      }
      setLines((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(box);
    document.fonts?.ready.then(layout);
    return () => ro.disconnect();
  }, [text]);

  // --- karaoke: each word changes as the playhead reaches it (todo → now → done), written as a data
  //     attribute only when it changes; result: the colour-in, --p per word (no React renders)
  useEffect(() => {
    let raf = 0;
    let last = "";
    const loop = () => {
      const n = words.length;
      if (mode === "karaoke") {
        const t = clock?.current ?? null;
        const states = words.map((w) => (t === null ? "idle" : t < w.start - 0.03 ? "todo" : t <= w.end + 0.03 ? "now" : "done"));
        const gs = words.map((_, i) => Math.min(1, Math.max(0, hits?.current[i] ?? 0)));
        const sig = `${states.join(",")}|${gs.map((g) => g.toFixed(3)).join(",")}`;
        if (sig !== last) {
          last = sig;
          states.forEach((st, i) => {
            const el = wordRefs.current[i];
            if (!el) return;
            if (el.dataset.state !== st) el.dataset.state = st;
            el.style.setProperty("--g", String(gs[i]));
          });
        }
      } else {
        const r = reveal ? reveal.current : 1;
        const ps = words.map((_, i) => Math.min(1, Math.max(0, r * n - i)));
        const sig = ps.map((p) => p.toFixed(3)).join(",");
        if (sig !== last) {
          last = sig;
          ps.forEach((p, i) => wordRefs.current[i]?.style.setProperty("--p", String(p)));
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [words, mode, clock, reveal, hits]);

  const groups = lines ?? [tokens.map((_, i) => i)];
  const single = groups.length === 1;

  return (
    <div
      ref={boxRef}
      className={`telop en relative w-full ${className ?? ""}`}
      data-mode={mode}
      // room under the last line for descenders + outline, and for the sound marks in result mode
      style={{ paddingBottom: mode === "result" ? "0.42em" : "0.14em" }}
    >
      {/* measuring row: same font, never seen, never widens the page */}
      <div aria-hidden className="pointer-events-none invisible absolute left-0 top-0 h-0 w-0 overflow-hidden">
        <div ref={measureRef} className="w-max whitespace-pre">
          {tokens.map((t, i) => (
            <span key={i} style={{ paddingInline: "0.12em" }}>
              {t}
            </span>
          ))}
          <span> </span>
        </div>
      </div>

      {mode === "karaoke" ? <span className="sr-only">{text}</span> : null}
      {groups.map((g, li) => (
        <div
          key={li}
          aria-hidden={mode === "karaoke" ? true : undefined}
          // karaoke: one axis — every line from the same left edge (the IPA and the meaning below follow it)
          className={`flex ${mode === "karaoke" ? (!lines ? "flex-wrap justify-start" : "justify-start") : !lines ? "flex-wrap justify-center" : single ? "justify-center" : li % 2 === 0 ? "justify-start" : "justify-end"}`}
          style={{ columnGap: mode === "karaoke" ? "0.26em" : "0.24em", marginTop: li ? (mode === "result" ? "0.32em" : "0.06em") : 0 }}
        >
          {g.map((i) => (
            <Word
              key={i}
              i={i}
              token={tokens[i]}
              result={mode === "result" ? results?.[i] : undefined}
              dim={selected != null && selected !== i}
              selected={selected === i}
              onSelect={mode === "result" ? onSelect : undefined}
              refFn={(el) => {
                wordRefs.current[i] = el;
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function Word({
  i,
  token,
  result,
  dim,
  selected,
  onSelect,
  refFn,
}: {
  i: number;
  token: string;
  result?: WordScore;
  dim: boolean;
  selected: boolean;
  onSelect?: (i: number) => void;
  refFn: (el: HTMLElement | null) => void;
}) {
  const j = result ? judge(result.score) : null;
  const style = {
    paddingInline: "0.12em",
    ...(j ? { "--tl-sung": JUDGEMENT_VAR[j] } : {}),
    // only when another word is selected; otherwise the stylesheet decides (karaoke: dim until reached)
    ...(dim ? { opacity: 0.5 } : {}),
  } as CSSProperties;

  const layers = (
    <>
      <span className="tl tl-a" aria-hidden>
        {letters(token, result?.phones, false)}
      </span>
      <span className="tl tl-b" aria-hidden>
        {letters(token, result?.phones, false)}
      </span>
      {result ? (
        <span className="tl" aria-hidden style={{ color: "transparent" }}>
          {letters(token, result.phones, true)}
        </span>
      ) : null}
    </>
  );

  if (!onSelect || !result) {
    return (
      <span ref={refFn} className="telop-word" style={style}>
        {layers}
      </span>
    );
  }
  const worst = [...result.phones].sort((a, b) => a.score - b.score)[0];
  const heard = worst ? heardLine(worst) : null;
  return (
    <button
      ref={refFn}
      type="button"
      className="telop-word cursor-pointer rounded-[0.18em] text-left"
      style={style}
      aria-pressed={selected}
      aria-label={`${token.replace(/[.,!?]/g, "")}、${JUDGEMENT_LABEL[j!]}。${heard ? heard + "。" : ""}くわしく見る`}
      onClick={() => onSelect(i)}
    >
      {layers}
    </button>
  );
}

/** Split a word into the letters of each sound; mark layer adds the glyph under each group. */
function letters(token: string, phones: PhoneScore[] | undefined, withMarks: boolean): ReactNode {
  if (!phones || !phones.some((p) => p.letters)) return token;
  const out: ReactNode[] = [];
  let cursor = 0;
  phones.forEach((p, k) => {
    if (!p.letters) return;
    const [a, b] = p.letters;
    if (a > cursor) out.push(token.slice(cursor, a));
    const m = mark(p);
    out.push(
      <span key={k} className="relative">
        {token.slice(a, b)}
        {withMarks ? <MarkGlyph m={m} /> : null}
      </span>,
    );
    cursor = b;
  });
  if (cursor < token.length) out.push(token.slice(cursor));
  return out;
}

function MarkGlyph({ m }: { m: Mark }) {
  if (m === "miss")
    return (
      <span
        className="absolute left-[0.04em] right-[0.04em] rounded-full"
        style={{
          top: "calc(100% + 0.05em)",
          height: "0.16em",
          minWidth: "0.42em",
          background: "var(--j-almost)",
          border: "0.045em solid var(--ink)",
        }}
      />
    );
  const size = m === "hit" ? "0.17em" : "0.27em";
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className="absolute left-1/2 -translate-x-1/2"
      style={{ top: "calc(100% + 0.08em)", width: size, height: size, overflow: "visible" }}
    >
      {m === "hit" ? (
        <circle cx="10" cy="10" r="7" fill="#fff" stroke="var(--ink)" strokeWidth="5" paintOrder="stroke" />
      ) : m === "near" ? (
        <path d="M10 2 L18.5 17 H1.5 Z" fill="var(--j-good)" stroke="var(--ink)" strokeWidth="4" strokeLinejoin="round" paintOrder="stroke" />
      ) : null}
    </svg>
  );
}

/** memoised: the practice screen re-renders on every phase change, the Telop only when its props change */
export default memo(Telop);
