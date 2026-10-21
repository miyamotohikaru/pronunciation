import { CAPTURE_WORKLET_SOURCE } from "@/engine/audio/capture-worklet.ts";

/**
 * The microphone capture AudioWorklet, served same-origin so it loads under
 * COEP: require-corp (and a future `script-src 'self'` CSP). Built once at build time.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response(CAPTURE_WORKLET_SOURCE, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
