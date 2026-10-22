import type { Metadata, Viewport } from "next";
import AbcPage from "@/ui/abc/AbcPage";
import { abcSets, confusions, letters } from "@/ui/abc/data.server";
import "@/ui/sounds/dict.css";

export const metadata: Metadata = { title: "アルファベット｜発音カラオケ" };
export const viewport: Viewport = { themeColor: "#f4f5fa" };

/** /abc — the 26 letter names, the sets that get mixed up, and the lines that spell letters. */
export default function Page() {
  return <AbcPage letters={letters()} confusions={confusions()} sets={abcSets()} />;
}
