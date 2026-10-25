import type { Metadata, Viewport } from "next";
import PlacementResult from "@/ui/check/PlacementResult";
import { placement } from "@/ui/mock";

export const metadata: Metadata = { title: "伸びしろトップ3｜発音カラオケ" };
export const viewport: Viewport = { themeColor: "#ffd338" };

/** /check/result — placement result with mock data. */
export default function Page() {
  return (
    <PlacementResult
      sentences={placement.sentences}
      top={placement.top}
      skipped={placement.skipped}
      route={placement.route}
      startHref="/learn/demo"
      backHref="/home"
    />
  );
}
