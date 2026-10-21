import type { Viewport } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import "@/ui/tokens.css";

// Japanese font: no subsets (the CSS is split by unicode-range), not preloaded.
const rounded = M_PLUS_Rounded_1c({
  weight: ["400", "500", "700", "800", "900"],
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
