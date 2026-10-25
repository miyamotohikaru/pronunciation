import type { Viewport } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import localFont from "next/font/local";
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

// ONE Latin face for the whole app — English sentences, sounds (IPA) and the Latin letters inside
// Japanese copy: SIL's Andika (made for reading; every IPA letter, ɚ́ ɪ́ with their accents placed),
// cut down to the letters we show (~24 KB a weight) with a double-story a (so a never reads as ɑ)
// and the tailed l (so l never reads as I or |). A subset is a Modified Version under the OFL and
// "Andika" is a Reserved Font Name, so the files carry their own name (Hatsuon IPA); see
// src/ui/fonts/OFL.txt and /credits. Weights 500 / 600 / 700 match the UI gothic (W5 / W6 / W7).
// Preloaded and font-display: block, so no glyph is ever drawn in a fallback face.
// (next/font needs the options written out as literals in each call.)
const latin = localFont({
  src: [
    { path: "../../ui/fonts/hatsuon-ipa-500.woff2", weight: "500", style: "normal" },
    { path: "../../ui/fonts/hatsuon-ipa-600.woff2", weight: "600", style: "normal" },
    { path: "../../ui/fonts/hatsuon-ipa-700.woff2", weight: "700", style: "normal" },
  ],
  display: "block",
  preload: true,
  adjustFontFallback: false,
  variable: "--font-latin",
});
// The same files, for letters only (no digits, no punctuation) at the head of the Japanese stack:
// 「舌を付ける l」 gets the tailed l, 「4分」「1/8」 keep the gothic's figures. A touch larger, so its
// x-height sits with the gothic's Latin.
const latinInJa = localFont({
  src: [
    { path: "../../ui/fonts/hatsuon-ipa-500.woff2", weight: "500", style: "normal" },
    { path: "../../ui/fonts/hatsuon-ipa-600.woff2", weight: "600", style: "normal" },
    { path: "../../ui/fonts/hatsuon-ipa-700.woff2", weight: "700", style: "normal" },
  ],
  display: "block",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0041-005A, U+0061-007A, U+00C0-00D6, U+00D8-00F6, U+00F8-00FF, U+0131, U+014B, U+0152-0153, U+0250-02B8, U+02C8, U+02CC, U+02D0-02D1, U+0300-036F, U+03B2, U+03B8, U+03C7",
    },
    { prop: "size-adjust", value: "104%" },
  ],
  variable: "--font-latin-ja",
});

export const viewport: Viewport = {
  themeColor: "#2d5bff",
  colorScheme: "light",
};

/** Game routes (/home, /play, /check, /learn): own fonts and tokens; each page sets its field colour. */
export default function GameLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={`${rounded.variable} ${latin.variable} ${latinInJa.variable}`}>{children}</div>;
}
