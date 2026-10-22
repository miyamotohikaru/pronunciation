import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import PracticeChain from "@/ui/challenge/common/PracticeChain";
import FieldBlank from "@/ui/challenge/common/FieldBlank";
import { FIELD, allScriptIds, pairsFor, scriptOf } from "@/ui/challenge/data.server";
import { FIELD_HEX } from "@/ui/practice/fields";

type Params = { id: string };

export const dynamicParams = false;
export const generateStaticParams = () => allScriptIds().map((id) => ({ id }));
export const viewport: Viewport = { themeColor: FIELD_HEX[FIELD.intro] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const s = scriptOf((await params).id);
  return { title: s ? `${s.titleJa}（1文ずつ）｜発音カラオケ` : "発音カラオケ" };
}

/** /challenge/intro/[id]/lines — ① the script's lines one by one on the practice screen (?i= resumes). */
export default async function Page({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const s = scriptOf(id);
  if (!s) notFound();
  const ready = s.lines.every((l) => l.ready);
  return (
    <Suspense fallback={<FieldBlank field={FIELD.intro} />}>
      <PracticeChain
        field={FIELD.intro}
        title={s.titleJa}
        items={s.lines}
        backHref={`/challenge/intro/${id}`}
        pairs={pairsFor(s.lines.map((l) => l.text))}
        next={ready ? { href: `/challenge/intro/${id}/run`, label: "② 通しで言う" } : null}
        summaryNote="次は、全部を続けて言ってみましょう。"
      />
    </Suspense>
  );
}
