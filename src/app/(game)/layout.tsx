import type { Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Gentium_Plus, M_PLUS_Rounded_1c } from "next/font/google";
import "@/ui/tokens.css";

// Japanese font: no subsets (the CSS is split by unicode-range), not preloaded.
// Only the karaoke caption and the score use it, at one weight (each weight adds ~126 @font-face
// rules ≈ 33 KB gzip of render-blocking CSS). Everything else is the system's medium gothic.
const rounded = M_PLUS_Rounded_1c({
  weight: ["900"],
  display: "swap",
  preload: false,
  variable: "--font-rounded",
});

// English text: a Latin face whose l has a tail (rounded l reads as I or 1). Variable, latin only (~40 KB).
const latin = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-latin",
});

// Sounds (IPA): Gentium Plus (SIL, OFL) — made for phonetic text: every IPA letter (ɚ ɪ ʊ ð θ ŋ ː …)
// in one upright face, a serif l that never reads as I or |. Self-hosted by next/font, not preloaded;
// the latin-ext / greek files load only when a page shows those letters (unicode-range).
const ipa = Gentium_Plus({
  weight: ["400", "700"],
  subsets: ["latin", "latin-ext", "greek"],
  display: "swap",
  preload: false,
  variable: "--font-ipa",
});

export const viewport: Viewport = {
  themeColor: "#2d5bff",
  colorScheme: "light",
};

/** Game routes (/home, /play, /check, /learn): own fonts and tokens; each page sets its field colour. */
export default function GameLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={`${rounded.variable} ${latin.variable} ${ipa.variable}`}>{children}</div>;
}
