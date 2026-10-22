import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import PracticeChain from "@/ui/challenge/common/PracticeChain";
import FieldBlank from "@/ui/challenge/common/FieldBlank";
import { FIELD, allLongIds, longLevels, longOf, pairsFor } from "@/ui/challenge/data.server";
import { FIELD_HEX } from "@/ui/practice/fields";

type Params = { id: string };

export const dynamicParams = false;
export const generateStaticParams = () => allLongIds().map((id) => ({ id }));
export const viewport: Viewport = { themeColor: FIELD_HEX[FIELD.long] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const v = longOf((await params).id);
  return { title: v ? `長い文 ${v.level.titleJa}｜発音カラオケ` : "発音カラオケ" };
}

/** /challenge/long/[id] — the long sentences of one level on the practice screen, from this one. */
export default async function Page({ params }: { params: Promise<Params> }) {
  const v = longOf((await params).id);
  if (!v) notFound();
  const levels = longLevels();
  const next = levels[levels.findIndex((l) => l.id === v.level.id) + 1];
  return (
    <Suspense fallback={<FieldBlank field={FIELD.long} />}>
      <PracticeChain
        field={FIELD.long}
        title={`長い文　${v.level.titleJa}`}
        items={v.level.items}
        start={v.index}
        itemHref="/challenge/long/{id}"
        backHref="/challenge#long"
        pairs={pairsFor(v.level.items.map((x) => x.text))}
        next={next ? { href: `/challenge/long/${next.items[0].id}`, label: `次は「${next.titleJa}」` } : { href: "/challenge#intro", label: "自己紹介へ" }}
      />
    </Suspense>
  );
}
