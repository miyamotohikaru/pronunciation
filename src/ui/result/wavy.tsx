"use client";

/**
 * The wrong letters of a word: a light tag over the whole sound with a 2 px line under it (r for
 * R, "th" for /ð/) — a mark the size of the sound, not a red letter with a squiggle.
 */
import type { ReactNode } from "react";
import type { WordScore } from "../types";
import { mark } from "../score";

/** the letters of a wrong sound: a light tag over the whole sound, a 2 px line under it, the text stays ink */
export function Wavy({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[0.18em] px-[0.04em] pb-[0.02em] shadow-[inset_0_-2px_0_var(--miss)]" style={{ background: "color-mix(in srgb, var(--miss) 14%, transparent)" }}>
      {children}
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
