import type { Metadata, Viewport } from "next";
import HomeScreen from "@/ui/home/HomeScreen";
import { home } from "@/ui/mock";

export const metadata: Metadata = { title: "ホーム｜発音カラオケ" };
export const viewport: Viewport = { themeColor: "#ffd338" };

const SCREENS = [
  { href: "/check/result", label: "診断の結果（伸びしろトップ3）" },
  { href: "/learn/demo", label: "レッスン：しくみ（r と l の舌）" },
  { href: "/learn/demo?step=ear", label: "レッスン：聞き分け" },
  { href: "/learn/demo?step=ear&answer=B", label: "レッスン：聞き分けの答え" },
  { href: "/play/demo", label: "練習：最初から（触って動かす）" },
  { href: "/play/demo?state=listen&t=0.7", label: "練習：お手本を再生中" },
  { href: "/play/demo?state=recording", label: "練習：録音中（2回目、ベストのゴーストつき）" },
  { href: "/play/demo?state=thinking", label: "練習：くらべている" },
  { href: "/play/demo?state=result", label: "練習：結果（1回目）" },
  { href: "/play/demo?state=result&take=2", label: "練習：結果（2回目、ベスト更新）" },
  { href: "/play/demo?state=result&take=3", label: "練習：結果（3回目、次へが主ボタン）" },
  { href: "/play/demo?state=result&take=4", label: "練習：結果（4回目、PERFECT）" },
  { href: "/play/demo?state=detail", label: "練習：音ごとの聞きくらべ（rice）" },
];

/** /home — today's route with mock data (the real top page `/` is not part of the game routes yet). */
export default function Page() {
  return (
    <HomeScreen
      streakDays={home.streakDays}
      week={home.week}
      todayIndex={home.todayIndex}
      nativeness={home.nativeness}
      route={home.route}
      skipped={home.skipped}
      continueHref="/play/demo"
      continueLabel={{ unit: "R と L", lesson: "舌先を付けない r" }}
      screens={SCREENS}
    />
  );
}
