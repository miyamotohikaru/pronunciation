/** Each unit owns one flat colour field (tokens.css .field-*). */
const ORDER = ["field-rhythm", "field-teal", "field-rl", "field-berry", "field-amber", "field-th"] as const;
export type FieldClass = (typeof ORDER)[number] | "field-shell";

export function fieldFor(unitId: string): FieldClass {
  const n = parseInt(unitId.replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? ORDER[(n - 1) % ORDER.length] : "field-shell";
}

/** the flat colour itself (for theme-color) */
export const FIELD_HEX: Record<FieldClass, string> = {
  "field-rhythm": "#ff7a2e",
  "field-teal": "#19c3b5",
  "field-rl": "#2d5bff",
  "field-berry": "#c92d70",
  "field-amber": "#ffb300",
  "field-th": "#16b06a",
  "field-shell": "#ffd338",
};
