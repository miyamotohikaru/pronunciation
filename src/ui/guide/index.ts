/**
 * The guide renderer used by the practice screen. Swap the export to change the look;
 * both take the same GuideProps (./types).
 *   WaveGuide — the model's melody as one flowing ribbon (owner's choice, 2026-10)
 *   BarsGuide — DAM-style syllable bars
 */
export { default as Guide } from "./WaveGuide";
export { default as WaveGuide, offStretches } from "./WaveGuide";
export { default as BarsGuide } from "./BarsGuide";
export * from "./types";
