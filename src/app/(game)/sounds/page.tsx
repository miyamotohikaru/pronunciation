import type { Metadata, Viewport } from "next";
import SoundBoard from "@/ui/sounds/SoundBoard";
import { boardSounds } from "@/ui/sounds/data.server";

export const metadata: Metadata = { title: "発音一覧｜発音カラオケ" };
export const viewport: Viewport = { themeColor: "#f4f5fa" };

/**
 * /sounds — 発音一覧: the 42 sounds (content/phonemes.json) on one screen; pressing a sound changes
 * the viewer in place (tongue, sound, a word to say and check). /sounds?s=IY opens that sound.
 */
export default function Page() {
  return <SoundBoard sounds={boardSounds()} />;
}
