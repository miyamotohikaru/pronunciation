/**
 * Small pieces the new corners share (チャレンジ / 発音記号 / アルファベット): the page header with
 * its way back, stars and a best score, and the play glyph that turns into a speaker while it plays.
 * Same grammar as the rest of the app: system gothic for Japanese, the Latin face for English,
 * the heavy rounded face only for scores.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { IconPlay, IconSpeaker, IconStar } from "../../icons";
import { starsFor } from "../../practice/progress";

/** ← (the icons file has × for leaving a practice; lists go back with an arrow) */
export function IconBack({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 5.5 8.5 12 15 18.5" />
    </svg>
  );
}

export function IconChevron({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </svg>
  );
}

/** ⇄ for "in turn" (A, B, A, B) */
export function IconAlternate({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8.5h14l-3.5-3.5M20 15.5H6l3.5 3.5" />
    </svg>
  );
}

export function PageHeader({ backHref, backLabel, title, right }: { backHref: string; backLabel: string; title: string; right?: ReactNode }) {
  return (
    <header className="mx-auto flex h-14 w-full max-w-[720px] items-center gap-1 px-2 md:h-16">
      <Link href={backHref} aria-label={backLabel} className="grid size-11 shrink-0 place-items-center rounded-full">
        <IconBack />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-[18px] font-black leading-none md:text-[20px]">{title}</h1>
      {right}
    </header>
  );
}

/** ★★☆ for a best score (none: three empty outlines, quiet) */
export function Stars({ score, size = 14 }: { score: number | undefined; size?: number }) {
  const n = score === undefined ? 0 : starsFor(score);
  return (
    <span className="inline-flex items-center gap-[1px]" aria-label={score === undefined ? "まだ" : `星 ${n} / 3`} role="img">
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ opacity: score === undefined ? 0.35 : i < n ? 1 : 0.45 }}>
          <IconStar size={size} filled={i < n} />
        </span>
      ))}
    </span>
  );
}

/** a best score on the right of a row: the number, or a quiet まだ */
export function BestMark({ score }: { score: number | undefined }) {
  if (score === undefined) return null;
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <Stars score={score} />
      <span className="num text-[13px] font-bold leading-none" style={{ opacity: score === undefined ? 0.55 : 1 }}>
        {score === undefined ? "まだ" : `${Math.round(score)}点`}
      </span>
    </span>
  );
}

/** the play glyph of a listen button; a speaker while its clip sounds */
export function PlayGlyph({ playing, size = 14 }: { playing: boolean; size?: number }) {
  return playing ? <IconSpeaker size={size + 4} /> : <IconPlay size={size} />;
}

/** the letters of `word` that spell the sound, from content's "m[ee]t" */
export function Marked({ marked, word }: { marked?: string; word: string }) {
  if (!marked || !marked.includes("[")) return <>{word}</>;
  const parts = marked.split(/(\[[^\]]+\])/).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("[") ? (
          <span key={i} className="font-bold underline decoration-[0.09em] underline-offset-[0.18em]">
            {p.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** "a\nb" (content's line breaks) → BreakText's ◇ (always) or ◆ (phone only) */
export const br = (s: string, mark: "◇" | "◆" = "◇") => s.replace(/\n/g, mark);

/**
 * content's running text: a new line after each sentence (。？！), and inside a sentence the line
 * may break only at its 、 (the .jp class keeps words together; content's \n after every 、 would
 * stack one-word lines on a phone)
 */
export const flow = (s: string) =>
  s
    .replace(/([。？！])\n/g, "$1◇")
    .replace(/\n/g, "")
    .replace(/◇$/, "")
    // a space next to Japanese ("l やラ行") is not a place to break the line: only 、 and 。 are
    .replace(/ (?=[\u3000-\u30ff\u4e00-\u9fff])|(?<=[\u3000-\u30ff\u4e00-\u9fff]) /g, "\u00a0");

/**
 * Where a short Japanese name may wrap in a narrow tile: after を, に, で, て (the .jp class keeps
 * words together, so without these a name could only break inside a word)
 */
export const softBreaks = (s: string) => s.replace(/([をにでて])(?=[\u3040-\u30ff\u4e00-\u9fff])/g, "$1\u200b");

