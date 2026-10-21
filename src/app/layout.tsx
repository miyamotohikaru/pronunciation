import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "発音カラオケ",
  description: "アメリカ英語の発音を、お手本と重ねて練習する。",
  // 公開の準備ができるまで検索に出さない
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
