import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import PracticeChain from "@/ui/challenge/common/PracticeChain";
import FieldBlank from "@/ui/challenge/common/FieldBlank";
import { pairsFor } from "@/ui/challenge/data.server";
import { ABC_FIELD, abcSetOf, abcSets, allAbcSetIds } from "@/ui/abc/data.server";
import { FIELD_HEX } from "@/ui/practice/fields";

type Params = { set: string };

export const dynamicParams = false;
export const generateStaticParams = () => allAbcSetIds().map((set) => ({ set }));
export const viewport: Viewport = { themeColor: FIELD_HEX[ABC_FIELD] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const s = abcSetOf((await params).set);
  return { title: s ? `${s.titleJa}｜アルファベット｜発音カラオケ` : "発音カラオケ" };
}

/** /abc/[set] — one set of letter lines on the practice screen (?i= starts / resumes). */
export default async function Page({ params }: { params: Promise<Params> }) {
  const { set } = await params;
  const s = abcSetOf(set);
  if (!s) notFound();
  const all = abcSets();
  const n = all[all.findIndex((x) => x.id === set) + 1];
  return (
    <Suspense fallback={<FieldBlank field={ABC_FIELD} />}>
      <PracticeChain
        field={ABC_FIELD}
        title={s.titleJa}
        items={s.lines}
        backHref="/abc#lines-h"
        pairs={pairsFor(s.lines.map((l) => l.text))}
        next={n ? { href: `/abc/${n.id}`, label: `次は「${n.titleJa}」` } : null}
      />
    </Suspense>
  );
}
