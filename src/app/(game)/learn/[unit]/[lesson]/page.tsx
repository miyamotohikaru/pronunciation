import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import LessonFlow from "@/ui/practice/LessonFlow";
import { getLesson } from "@/ui/practice/catalog.server";
import { FIELD_HEX, fieldFor } from "@/ui/practice/fields";

type Params = { unit: string; lesson: string };
type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { unit, lesson } = await params;
  const v = getLesson(unit, lesson);
  return { title: v ? `${v.lesson.titleJa}｜発音カラオケ` : "発音カラオケ" };
}

export async function generateViewport({ params }: { params: Promise<Params> }): Promise<Viewport> {
  const { unit } = await params;
  return { themeColor: FIELD_HEX[fieldFor(unit)] };
}

/** /learn/[unit]/[lesson] — a lesson from the catalog. ?i=N starts at item N (skips the intro). */
export default async function Page({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<SP> }) {
  const { unit, lesson } = await params;
  const v = getLesson(unit, lesson);
  if (!v) notFound();
  const sp = await searchParams;
  const raw = Array.isArray(sp.i) ? sp.i[0] : sp.i;
  const i = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
  return <LessonFlow key={`${unit}/${lesson}`} field={fieldFor(unit)} unit={v.unit} lesson={v.lesson} next={v.next} initialIndex={i} />;
}
