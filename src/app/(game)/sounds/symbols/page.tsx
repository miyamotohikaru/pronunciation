import type { Metadata, Viewport } from "next";
import Legend from "@/ui/sounds/Legend";
import { STYLE_JA, legendGroups } from "@/ui/sounds/data.server";
import "@/ui/sounds/dict.css";

export const metadata: Metadata = { title: "記号の読み方｜発音カラオケ" };
export const viewport: Viewport = { themeColor: "#f4f5fa" };

/** /sounds/symbols — the 53 symbols and marks of content/ipa-legend.json. */
export default function Page() {
  return <Legend groups={legendGroups()} styleJa={STYLE_JA} />;
}
