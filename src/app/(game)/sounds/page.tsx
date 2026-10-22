import type { Metadata, Viewport } from "next";
import SoundsGrid from "@/ui/sounds/SoundsGrid";
import { soundGroups } from "@/ui/sounds/data.server";
import "@/ui/sounds/dict.css";

export const metadata: Metadata = { title: "発音記号｜発音カラオケ" };
export const viewport: Viewport = { themeColor: "#f4f5fa" };

/** /sounds — the 42 sounds (content/phonemes.json) grouped 母音 / 二重母音 / 子音. */
export default function Page() {
  return <SoundsGrid groups={soundGroups()} />;
}
