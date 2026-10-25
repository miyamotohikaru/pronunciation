import type { Metadata, Viewport } from "next";
import ChallengeHub from "@/ui/challenge/ChallengeHub";
import { longLevels, scenes, scripts } from "@/ui/challenge/data.server";

export const metadata: Metadata = { title: "チャレンジ｜発音カラオケ" };
export const viewport: Viewport = { themeColor: "#f4f5fa" };

/** /challenge — 長い文・自己紹介・会話 (content/challenge.json), with this device's best scores. */
export default function Page() {
  return (
    <ChallengeHub
      long={longLevels()}
      scripts={scripts().map((s) => ({
        id: s.id,
        titleJa: s.titleJa,
        situationJa: s.situationJa,
        first: { text: s.lines[0].text, swaps: s.lines[0].swaps },
        lineIds: s.lines.map((l) => l.id),
        swapCount: s.lines.reduce((a, l) => a + l.swaps.length, 0),
      }))}
      scenes={scenes().map((s) => ({
        id: s.id,
        titleJa: s.titleJa,
        situationJa: s.situationJa,
        preview: s.turns.slice(0, 2).map((t) => ({ role: t.role, text: t.text })),
        turns: s.turns.length,
        youIds: s.turns.filter((t) => t.role === "you").map((t) => t.id),
      }))}
    />
  );
}
