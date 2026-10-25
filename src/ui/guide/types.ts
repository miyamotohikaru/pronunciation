/**
 * The guide (目印) contract. The practice screen only talks to this; the drawing is swappable
 * (src/ui/guide/index.ts picks the renderer). Everything is on the guide timeline of the chosen
 * speed (seconds, 0 = the start of the model audio). Live values come through a mutable ref that
 * the screen updates from the recorder/player callbacks — renderers read it inside their own
 * requestAnimationFrame loop, so React never re-renders per frame.
 */
import type { BarLive, GuideBar, GuideWave } from "@/engine/karaoke/judge.ts";
import type { ContourPoint } from "@/engine/prosody/types.ts";

export type GuideLive = {
  /** cursor on the guide timeline; null = nothing running */
  t: number | null;
  /** true while the guide runs (お手本 / count-in / singing / replay): the view follows the cursor */
  follow: boolean;
  /** your live line (KaraokeJudge.line): semitones vs your own median, same scale as the wave;
   *  inBand = inside the guide's tolerance band at that moment (judge built with { wave }) */
  line: readonly { t: number; st: number | null; inBand?: boolean }[];
  /** per syllable fill / grade (KaraokeJudge.bars); null before the first take */
  bars: readonly BarLive[] | null;
  /** cursor colour: the model's (cyan) or yours (replay, yellow) */
  tone: "guide" | "voice";
  /** bump to force one redraw after mutating arrays in place */
  version: number;
};

export type GuideProps = {
  /** the model's melody for this voice and speed (buildGuideWave) */
  wave: GuideWave;
  /** the model's syllables for this voice and speed (KaraokeJudge's bars) */
  syllables: readonly GuideBar[];
  words: readonly { text: string; start: number; end: number }[];
  /** optional: each word split into its syllables (strong = the sentence's stressed one, drawn a
   *  size up). Used only where the pieces spell the word exactly; otherwise the word is drawn whole. */
  pieces?: readonly (readonly { text: string; strong: boolean }[])[] | null;
  live: { current: GuideLive };
  /** after the take: your contour on the guide timeline (compareProsody's userOnRefTime) */
  overlay?: readonly ContourPoint[] | null;
  /** replay: draw the overlay only up to the cursor */
  progressive?: boolean;
  /** dim everything but one word (sound card open) */
  focusWord?: number | null;
  /** the judge's tolerance (±semitones): the band is drawn exactly this thick, so overlap == hit */
  tolSt?: number;
  /** stretches where you were off (after the take), shaded lightly behind the band */
  offStretches?: readonly { start: number; end: number }[] | null;
  /** screen-reader summary */
  label: string;
  className?: string;
};

export const freshLive = (): GuideLive => ({ t: null, follow: false, line: [], bars: null, tone: "guide", version: 0 });
