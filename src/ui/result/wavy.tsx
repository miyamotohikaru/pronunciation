"use client";

/**
 * The wrong letters of a word: error colour and a wavy line under them. The line is at least
 * 1.2em wide (a one-letter wave read as a ✓) and centred under the letters, but kept inside its
 * own word — so the waves of neighbouring words never run together. useFitWaves does the
 * keeping: it measures inside a ResizeObserver callback, which runs after the browser's own
 * layout and before paint — so it never forces an extra layout (nothing per frame either).
 */
import { useEffect, type ReactNode, type RefObject } from "react";
import type { WordScore } from "../types";
import { mark } from "../score";

export function Wavy({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-block font-extrabold text-(--miss)">
      {children}
      <span aria-hidden data-wave className="kara-wavy pointer-events-none absolute left-1/2 top-[100%] h-[0.22em] -translate-x-1/2" style={{ width: "max(100%, 1.2em)" }} />
    </span>
  );
}

/** letter ranges of the missed sounds, touching ranges merged ("Th" + "e" → "The") */
export function missRanges(w: WordScore): [number, number][] {
  const ms = w.phones
    .filter((p) => mark(p) === "miss" && p.letters && p.letters[1] > p.letters[0])
    .map((p) => [p.letters![0], p.letters![1]] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const m of ms) {
    const last = out[out.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else out.push(m);
  }
  return out;
}

/** the token with its wrong letters marked (a miss without letters marks the whole word) */
export function marked(token: string, w: WordScore): ReactNode {
  const ranges = missRanges(w);
  if (!ranges.length) return w.phones.some((p) => mark(p) === "miss") ? <Wavy>{token}</Wavy> : token;
  const out: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], k) => {
    if (a > at) out.push(token.slice(at, a));
    out.push(<Wavy key={k}>{token.slice(Math.max(a, at), b)}</Wavy>);
    at = Math.max(at, b);
  });
  if (at < token.length) out.push(token.slice(at));
  return out;
}

/** keep every wave under `root` inside the [data-word] element around it (± 0.1em) */
export function useFitWaves(root: RefObject<HTMLElement | null>, key: unknown) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => {
      el.querySelectorAll<HTMLElement>("[data-word]").forEach((word) => {
        const waves = word.querySelectorAll<HTMLElement>("[data-wave]");
        if (!waves.length) return;
        const wr = word.getBoundingClientRect();
        const em = parseFloat(getComputedStyle(word).fontSize) || 16;
        waves.forEach((wave) => {
          const host = wave.parentElement!.getBoundingClientRect();
          const w = Math.max(host.width, 1.2 * em);
          const lo = wr.left - 0.1 * em;
          const hi = wr.right + 0.1 * em;
          let left = host.left + host.width / 2 - w / 2;
          if (hi - lo >= w) left = Math.min(Math.max(left, lo), hi - w);
          else left = wr.left + wr.width / 2 - w / 2; // a short word: centred on the word
          wave.style.left = `${(left - host.left).toFixed(1)}px`;
          wave.style.width = `${w.toFixed(1)}px`;
          wave.style.translate = "none"; // Tailwind's -translate-x-1/2 is the translate property
          wave.style.transform = "none";
        });
      });
    };
    // the first notification comes right after the first layout (no fit() here: reading now would force one)
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    document.fonts?.ready.then(() => requestAnimationFrame(fit)).catch(() => undefined);
    return () => ro.disconnect();
  }, [root, key]);
}
