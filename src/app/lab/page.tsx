import type { Metadata } from "next";
import Lab from "./Lab";

export const metadata: Metadata = {
  title: "audio lab",
  robots: { index: false, follow: false },
};

/** Engineering test bench for the audio engine (src/engine/audio). Not linked from the app. */
export default function LabPage() {
  return <Lab />;
}
