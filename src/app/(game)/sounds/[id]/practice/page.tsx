import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import PracticeChain from "@/ui/challenge/common/PracticeChain";
import FieldBlank from "@/ui/challenge/common/FieldBlank";
import { pairsFor } from "@/ui/challenge/data.server";
import { allSoundSlugs, soundOf } from "@/ui/sounds/data.server";
import { SOUNDS_FIELD } from "@/ui/sounds/field";
import { FIELD_HEX } from "@/ui/practice/fields";

type Params = { id: string };

export const dynamicParams = false;
export const generateStaticParams = () => allSoundSlugs().map((id) => ({ id }));
export const viewport: Viewport = { themeColor: FIELD_HEX[SOUNDS_FIELD] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const s = soundOf((await params).id);
  return { title: s ? `/${s.ipa}/ の文｜発音カラオケ` : "発音カラオケ" };
}

/** /sounds/[id]/practice — the sound's six sentences on the practice screen (?i= starts / resumes). */
export default async function Page({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const s = soundOf(id);
  if (!s) notFound();
  return (
    <Suspense fallback={<FieldBlank field={SOUNDS_FIELD} />}>
      <PracticeChain
        field={SOUNDS_FIELD}
        title={`/${s.ipa}/ の文`}
        items={s.practice}
        backHref={`/sounds/${id}`}
        pairs={pairsFor(s.practice.map((x) => x.text))}
        next={s.next ? { href: `/sounds/${s.next.slug}`, label: `次の音 /${s.next.ipa}/ へ` } : null}
      />
    </Suspense>
  );
}
