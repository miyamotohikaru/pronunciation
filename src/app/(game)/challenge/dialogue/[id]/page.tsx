import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import DuetScene from "@/ui/challenge/DuetScene";
import FieldBlank from "@/ui/challenge/common/FieldBlank";
import { FIELD, allSceneIds, pairsFor, sceneOf, scenes } from "@/ui/challenge/data.server";
import { FIELD_HEX } from "@/ui/practice/fields";

type Params = { id: string };

export const dynamicParams = false;
export const generateStaticParams = () => allSceneIds().map((id) => ({ id }));
export const viewport: Viewport = { themeColor: FIELD_HEX[FIELD.dialogue] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const s = sceneOf((await params).id);
  return { title: s ? `会話 ${s.titleJa}｜発音カラオケ` : "発音カラオケ" };
}

/** /challenge/dialogue/[id] — a scene as a duet: their line (the other voice), then yours on the practice screen. */
export default async function Page({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const s = sceneOf(id);
  if (!s) notFound();
  const all = scenes();
  const n = all[all.findIndex((x) => x.id === id) + 1];
  return (
    <Suspense fallback={<FieldBlank field={FIELD.dialogue} />}>
      <DuetScene
        field={FIELD.dialogue}
        scene={s}
        next={n ? { href: `/challenge/dialogue/${n.id}`, titleJa: n.titleJa } : null}
        pairs={pairsFor(s.turns.filter((t) => t.role === "you").map((t) => t.text))}
      />
    </Suspense>
  );
}
