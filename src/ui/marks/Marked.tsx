"use client";

/**
 * The app's one way of marking an English line (tokens.css .mk-*):
 *   ● a small filled dot over the middle of each word's strong syllable (nothing on weak ones)
 *   ‿ a thin arc under the gap where a word runs on into the next one
 * Both in the text's own colour (a karaoke wipe paints them with the letters), absolutely placed
 * (they never widen a gap or move a letter) and aria-hidden (a screen reader reads the line as is).
 * Where a line breaks between two linked words the arc is left out (no arc hangs off a line end):
 * checked once per layout (ResizeObserver), never per frame.
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useState, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { ItemData } from "@/data/schema";
import { fetchItem } from "../practice/content";
import { lineMarks, type LineMarks } from "./lineMarks";

export type { LineMarks };

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** a line's marks from its item (memoised per item) */
export function useLineMarks(item: Pick<ItemData, "text" | "words"> | null | undefined): LineMarks | null {
  return useMemo(() => (item ? lineMarks(item.text, item.words) : null), [item]);
}

/**
 * Marks for a line known only by its id and text (a list of lines from the server): its item is
 * fetched once the line comes near the screen (`near`), when the browser is idle — the practice
 * that follows needs it anyway; until then, or if it is not there, the line shows plain (the marks
 * are absolutely placed, so nothing moves when they arrive).
 */
export function useItemMarks(id: string | null | undefined, near?: RefObject<HTMLElement | null>): LineMarks | null {
  const [m, setM] = useState<LineMarks | null>(null);
  useEffect(() => {
    if (!id) return;
    let ok = true;
    let h = 0;
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    const idle = typeof w.requestIdleCallback === "function";
    const run = () => {
      fetchItem(id)
        .then((it) => ok && setM(lineMarks(it.text, it.words)))
        .catch(() => undefined);
    };
    const soon = () => {
      h = idle ? w.requestIdleCallback!(run, { timeout: 1500 }) : window.setTimeout(run, 300);
    };
    const el = near?.current;
    let io: IntersectionObserver | null = null;
    if (el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (es) => {
          if (!es.some((e) => e.isIntersecting)) return;
          io?.disconnect();
          io = null;
          soon();
        },
        { rootMargin: "240px 0px" },
      );
      io.observe(el);
    } else soon();
    return () => {
      ok = false;
      io?.disconnect();
      if (idle) w.cancelIdleCallback?.(h);
      else clearTimeout(h);
    };
  }, [id, near]);
  return m;
}

/**
 * Leaves the ‿ out where the line breaks between two linked words: the next word then starts left
 * of this one's end. Elements: [data-mk-w=i] (several layers may repeat a word) holding the ‿,
 * [data-mk-l] when it links on, [data-mk-start=i] where word i begins if it is drawn in pieces;
 * sets [data-mk-wrap]. Runs at mount, on resize and when the fonts are in.
 */
export function useLinkWraps(ref: RefObject<HTMLElement | null>, key: unknown) {
  useIso(() => {
    const box = ref.current;
    if (!box) return;
    const host = (box.closest("p, div, li, section, button, h1, h2, h3") as HTMLElement | null) ?? box;
    let raf = 0;
    const check = () => {
      const els = Array.from(box.querySelectorAll<HTMLElement>("[data-mk-w]"));
      const first = new Map<number, HTMLElement>();
      for (const el of els) {
        const i = Number(el.dataset.mkW);
        if (!first.has(i)) first.set(i, el);
      }
      // where each word starts (a word drawn in several pieces marks its first one)
      const start = new Map<number, HTMLElement>();
      for (const el of Array.from(box.querySelectorAll<HTMLElement>("[data-mk-start]"))) {
        const i = Number(el.dataset.mkStart);
        if (!start.has(i)) start.set(i, el);
      }
      const wrap = new Set<number>();
      for (const [i, el] of first) {
        if (!el.hasAttribute("data-mk-l")) continue;
        const nx = start.get(i + 1) ?? first.get(i + 1);
        if (!nx || nx.getBoundingClientRect().left < el.getBoundingClientRect().right - 1) wrap.add(i);
      }
      for (const el of els) {
        const w = wrap.has(Number(el.dataset.mkW));
        if (w !== el.hasAttribute("data-mk-wrap")) {
          if (w) el.setAttribute("data-mk-wrap", "");
          else el.removeAttribute("data-mk-wrap");
        }
      }
    };
    check();
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(check);
    };
    const ro = new ResizeObserver(later);
    ro.observe(host);
    document.fonts?.ready.then(later);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [key]);
}

export type MarkedWordProps = {
  token: string;
  /** the strong syllable's letters in the token */
  strong: [number, number] | null;
  /** it runs on into the next word (‿ after it) */
  link: boolean;
  /** the word's place in the line (for the line-break check) */
  index: number;
  /** the gap to the next word's first letter, in em of this word (the arc spans it) */
  gap?: number;
  /** how a slice of the token is drawn (keycaps, highlights); plain text by default */
  render?: (slice: string, from: number) => ReactNode;
  className?: string;
  style?: CSSProperties;
};

/** one word: ● over its strong syllable, ‿ after it when it links on */
export function MarkedWord({ token, strong, link, index, gap, render, className, style }: MarkedWordProps) {
  const r = render ?? ((s: string) => s);
  const s = strong && strong[1] > strong[0] && strong[1] <= token.length ? strong : null;
  return (
    <span
      className={`mk-w${className ? ` ${className}` : ""}`}
      data-mk-w={index}
      data-mk-l={link ? "" : undefined}
      style={gap !== undefined ? ({ ...style, ["--mk-gap" as string]: `${gap.toFixed(3)}em` } as CSSProperties) : style}
    >
      {s ? (
        <>
          {s[0] > 0 ? r(token.slice(0, s[0]), 0) : null}
          <span className="mk-s">{r(token.slice(s[0], s[1]), s[0])}</span>
          {s[1] < token.length ? r(token.slice(s[1]), s[1]) : null}
        </>
      ) : (
        r(token, 0)
      )}
      {link ? <span aria-hidden className="mk-arc" /> : null}
    </span>
  );
}

export type MarkedTextProps = {
  text: string;
  marks: LineMarks | null;
  /** how a slice of word `i` is drawn (from = its offset in the token) */
  render?: (i: number, slice: string, from: number) => ReactNode;
  /** extra gap after word i (em), when the words carry padding of their own */
  gapAfter?: (i: number) => number;
  /** wraps word i (a button, a highlight); the word itself is the child */
  wrap?: (i: number, word: ReactNode) => ReactNode;
};

/** a line in ordinary text flow (words and plain spaces), marked */
export function MarkedText({ text, marks, render, gapAfter, wrap }: MarkedTextProps) {
  const box = useRef<HTMLSpanElement>(null);
  const tokens = text.split(/\s+/).filter(Boolean);
  const ok = !!marks && marks.strong.length === tokens.length;
  useLinkWraps(box, ok ? marks : null);
  if (!ok) return <span className="mk-lines">{wrap ? tokens.map((t, i) => <Fragment key={i}>{wrap(i, t)}{i < tokens.length - 1 ? " " : null}</Fragment>) : text}</span>;
  return (
    <span ref={box} className="mk-lines">
      {tokens.map((tok, i) => {
        const word = (
          <MarkedWord
            token={tok}
            strong={marks!.strong[i]}
            link={!!marks!.link[i] && i < tokens.length - 1}
            index={i}
            gap={gapAfter ? 0.27 + gapAfter(i) : undefined}
            render={render ? (s, from) => render(i, s, from) : undefined}
          />
        );
        return (
          <Fragment key={i}>
            {wrap ? wrap(i, word) : word}
            {i < tokens.length - 1 ? " " : null}
          </Fragment>
        );
      })}
    </span>
  );
}

/** the first time on the practice screen: how to read the marks, small, under the line */
export function MarksLegend({ className }: { className?: string }) {
  return (
    <p aria-hidden className={`flex items-center gap-4 text-[12px] font-bold leading-none ${className ?? ""}`}>
      <span className="inline-flex items-center gap-[6px]">
        <span className="mk-demo-dot" />
        強く
      </span>
      <span className="inline-flex items-center gap-[6px]">
        <span className="mk-demo-arc" />
        つなげて
      </span>
    </p>
  );
}

/** a line from a list (known by id and text): plain at first, marked once its item is in */
export function LineById({ id, text, ready = true }: { id: string; text: string; ready?: boolean }) {
  const near = useRef<HTMLSpanElement>(null);
  const marks = useItemMarks(ready ? id : null, near);
  return (
    <span ref={near} className="mk-lines">
      <MarkedText text={text} marks={marks} />
    </span>
  );
}
