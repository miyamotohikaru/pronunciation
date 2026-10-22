import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SoundDetail from "@/ui/sounds/SoundDetail";
import { allSoundSlugs, soundOf } from "@/ui/sounds/data.server";
import { SOUNDS_FIELD } from "@/ui/sounds/field";
import "@/ui/sounds/dict.css";

type Params = { id: string };

export const dynamicParams = false;
export const generateStaticParams = () => allSoundSlugs().map((id) => ({ id }));
export const viewport = { themeColor: "#f4f5fa" };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const s = soundOf((await params).id);
  return { title: s ? `/${s.ipa}/ ${s.name.text}｜発音カラオケ` : "発音カラオケ" };
}

/** /sounds/[id] — one of the 42 sounds: how to say it, words and pairs to hear, six sentences. */
export default async function Page({ params }: { params: Promise<Params> }) {
  const s = soundOf((await params).id);
  if (!s) notFound();
  return <SoundDetail s={s} field={SOUNDS_FIELD} />;
}
