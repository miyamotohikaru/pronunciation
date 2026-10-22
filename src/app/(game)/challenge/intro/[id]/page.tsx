import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import IntroScript from "@/ui/challenge/IntroScript";
import { FIELD, allScriptIds, scriptOf } from "@/ui/challenge/data.server";
import { FIELD_HEX } from "@/ui/practice/fields";

type Params = { id: string };

export const dynamicParams = false;
export const generateStaticParams = () => allScriptIds().map((id) => ({ id }));
export const viewport: Viewport = { themeColor: FIELD_HEX[FIELD.intro] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const s = scriptOf((await params).id);
  return { title: s ? `自己紹介 ${s.titleJa}｜発音カラオケ` : "発音カラオケ" };
}

/** /challenge/intro/[id] — one self-introduction script: ① line by line, ② the whole script. */
export default async function Page({ params }: { params: Promise<Params> }) {
  const s = scriptOf((await params).id);
  if (!s) notFound();
  return <IntroScript field={FIELD.intro} script={s} />;
}
