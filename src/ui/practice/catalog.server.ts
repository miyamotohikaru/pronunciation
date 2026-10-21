/**
 * Catalog access for server components only (the 86 KB catalog never ships to the browser;
 * pages pass the slices they need).
 */
import catalogJson from "@/data/catalog.json";
import type { Catalog } from "@/data/schema";

const catalog = catalogJson as unknown as Catalog;

export type LessonRef = { unitId: string; lessonId: string; href: string; titleJa: string };

export type LessonView = {
  unit: { id: string; titleJa: string; subtitleJa: string; whyJa: string; howJa: string };
  lesson: { id: string; titleJa: string; goalJa: string; items: { id: string; type: string; text: string; ja: string; pair?: string }[] };
  next: LessonRef | null;
};

export const lessonHref = (unitId: string, lessonId: string) => `/learn/${unitId}/${lessonId}`;

export function getLesson(unitId: string, lessonId: string): LessonView | null {
  const ui = catalog.units.findIndex((u) => u.id === unitId);
  if (ui < 0) return null;
  const u = catalog.units[ui];
  const li = u.lessons.findIndex((l) => l.id === lessonId);
  if (li < 0) return null;
  const l = u.lessons[li];
  const nu = li + 1 < u.lessons.length ? u : catalog.units[ui + 1];
  const nl = li + 1 < u.lessons.length ? u.lessons[li + 1] : nu?.lessons[0];
  return {
    unit: { id: u.id, titleJa: u.titleJa, subtitleJa: u.subtitleJa, whyJa: u.whyJa, howJa: u.howJa },
    lesson: { id: l.id, titleJa: l.titleJa, goalJa: l.goalJa, items: l.items.map((it) => ({ id: it.id, type: it.type, text: it.text, ja: it.ja, pair: it.pair })) },
    next: nu && nl ? { unitId: nu.id, lessonId: nl.id, href: lessonHref(nu.id, nl.id), titleJa: nl.titleJa } : null,
  };
}

export type HomeUnit = { id: string; titleJa: string; subtitleJa: string; lessons: { id: string; titleJa: string; href: string; items: string[] }[] };

export function getHome(): HomeUnit[] {
  return catalog.units.map((u) => ({
    id: u.id,
    titleJa: u.titleJa,
    subtitleJa: u.subtitleJa,
    lessons: u.lessons.map((l) => ({ id: l.id, titleJa: l.titleJa, href: lessonHref(u.id, l.id), items: l.items.map((it) => it.id) })),
  }));
}

export function allLessonParams(): { unit: string; lesson: string }[] {
  return catalog.units.flatMap((u) => u.lessons.map((l) => ({ unit: u.id, lesson: l.id })));
}
