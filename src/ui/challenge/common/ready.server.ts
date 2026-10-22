/**
 * Server only: which lines and listen-only clips are built yet. The new corners read content/*.json
 * (the source of the voice batch), so a line can exist before its recording does. The content
 * build lists exactly the lines it wrote in src/data/catalog.json (units, placement, sets), so
 * that is the record — no file-system checks (they would make the bundler trace every file under
 * public/ into the server output).
 * The listen-only clips (words of the sound pages, letter names) are recorded in the same voice
 * batch as their file's practice lines: they are there when that file's sets are in the catalog.
 * The browser still copes with a clip that fails to load (the button just stops).
 */
import catalogJson from "@/data/catalog.json";
import type { Catalog } from "@/data/schema";

const catalog = catalogJson as unknown as Catalog;

let built: Set<string> | null = null;
function builtIds(): Set<string> {
  if (built) return built;
  built = new Set<string>();
  for (const u of catalog.units) for (const l of u.lessons) for (const it of l.items) built.add(it.id);
  for (const p of catalog.placement) built.add(p.id);
  for (const s of catalog.sets ?? []) for (const it of s.items) built.add(it.id);
  return built;
}

/** the content build wrote public/content/items/<id>.json */
export function itemReady(id: string): boolean {
  return builtIds().has(id);
}

/** the listen-only clips of a content file ("phonemes": words, "alphabet": letter names) */
export function clipsReady(source: "phonemes" | "alphabet"): boolean {
  return (catalog.sets ?? []).some((s) => s.source === source);
}
