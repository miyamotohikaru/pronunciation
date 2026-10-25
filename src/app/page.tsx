import BreakText from "@/components/BreakText";

/** 仮のトップ。見た目はデザインチームがあとで作る。 */
export default function Home() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-bold">発音カラオケ</h1>
      <p className="mt-4 text-soft">
        <BreakText text="ただいま準備中です。◇お手本と重ねて、◆アメリカ英語の発音を練習できるようにします。" />
      </p>
    </main>
  );
}
