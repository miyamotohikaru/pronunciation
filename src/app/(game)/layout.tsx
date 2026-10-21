import type { Viewport } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import "@/ui/tokens.css";

// Japanese font: no subsets (the CSS is split by unicode-range), not preloaded.
// Two weights only: each weight adds ~126 @font-face rules (≈33 KB gzip of render-blocking CSS);
// 800 renders with 900 and 400/500 with 700 (CSS font matching).
const rounded = M_PLUS_Rounded_1c({
  weight: ["700", "900"],
  display: "swap",
  preload: false,
  variable: "--font-rounded",
});

export const viewport: Viewport = {
  themeColor: "#2d5bff",
  colorScheme: "light",
};

/** Game routes (/home, /play, /check, /learn): own fonts and tokens; each page sets its field colour. */
export default function GameLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={rounded.variable}>{children}</div>;
}
