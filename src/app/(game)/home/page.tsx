import type { Metadata, Viewport } from "next";
import HomeRoute from "@/ui/home/HomeRoute";
import { getHome } from "@/ui/practice/catalog.server";

export const metadata: Metadata = { title: "ホーム｜発音カラオケ" };
export const viewport: Viewport = { themeColor: "#ffd338" };

/** /home — the curriculum (units → lessons) with this device's progress. */
export default function Page() {
  return <HomeRoute units={getHome()} />;
}
