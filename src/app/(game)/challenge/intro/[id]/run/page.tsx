import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import ScriptRun from "@/ui/challenge/ScriptRun";
import { FIELD, allScriptIds, scriptOf } from "@/ui/challenge/data.server";
import { FIELD_HEX } from "@/ui/practice/fields";

type Params = { id: string };

export const dynamicParams = false;
export const generateStaticParams = () => allScriptIds().map((id) => ({ id }));
export const viewport: Viewport = { themeColor: FIELD_HEX[FIELD.intro] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const s = scriptOf((await params).id);
  return { title: s ? `${s.titleJa}（通しで）｜発音カラオケ` : "発音カラオケ" };
}

/** /challenge/intro/[id]/run — ② the whole script in one take, each line scored for its sounds. */
export default async function Page({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const s = scriptOf(id);
  if (!s) notFound();
  if (!s.lines.every((l) => l.ready)) notFound();
  return <ScriptRun field={FIELD.intro} script={{ id: s.id, titleJa: s.titleJa, lines: s.lines.map((l) => ({ id: l.id, text: l.text, ja: l.ja, swaps: l.swaps })) }} backHref={`/challenge/intro/${id}`} />;
}
