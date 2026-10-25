import type { FieldClass } from "../../practice/fields";

/** the field colour alone, while a practice screen starts on the client (Suspense fallback) */
export default function FieldBlank({ field }: { field: FieldClass | "field-calm" }) {
  return <div className={`kara ${field} min-h-dvh`} aria-busy="true" />;
}
