"use client";

/**
 * The guide as DAM-style syllable bars (the first design). Same props as WaveGuide, drawn by
 * PitchLane; kept so the guide renderer stays swappable (src/ui/guide/index.ts).
 */
import { useMemo, useRef } from "react";
import PitchLane, { type BarFill, type LiveTake } from "../lane/PitchLane";
import type { GuideProps } from "./types";

export default function BarsGuide(p: GuideProps) {
  const contour = useMemo(() => p.wave.segments.flat().map((pt) => ({ t: pt.t, st: pt.st })), [p.wave]);
  const syllables = useMemo(() => p.syllables.map((s) => ({ ...s })), [p.syllables]);
  const words = useMemo(() => p.words.map((w) => ({ ...w })), [p.words]);
  // views onto the live ref, read by PitchLane every frame
  const liveRef = useRef<{ readonly current: LiveTake }>({
    get current() {
      const l = p.live.current;
      return { points: l.line as LiveTake["points"], t: l.follow ? l.t : null };
    },
  });
  const playRef = useRef<{ readonly current: number | null }>({
    get current() {
      const l = p.live.current;
      return l.follow ? null : l.t;
    },
  });
  const fillsRef = useRef<{ readonly current: readonly BarFill[] | null }>({
    get current() {
      return p.live.current.bars;
    },
  });
  const follow = p.live.current.follow;
  const mode = p.overlay ? "overlay" : follow ? "live" : "guide";
  return (
    <PitchLane
      className={p.className}
      syllables={syllables}
      contour={contour}
      words={words}
      mode={mode}
      playhead={playRef.current as { current: number | null }}
      playheadTone={p.live.current.tone}
      live={liveRef.current as { current: LiveTake }}
      fills={fillsRef.current}
      take={p.overlay ? { onRef: p.overlay as { t: number; st: number | null }[] } : null}
      progressive={p.progressive}
      focusWord={p.focusWord}
      label={p.label}
    />
  );
}
