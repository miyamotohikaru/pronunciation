import type { NextConfig } from "next";

/**
 * Cross-origin isolation on every route (pages, route handlers, /_next assets, public files).
 * Needed for SharedArrayBuffer → multi-threaded WASM inference later, and checked on /lab
 * (`crossOriginIsolated === true`). Consequence: every subresource must be same-origin or
 * send CORP/CORS headers — keep fonts, models, audio and scripts self-hosted.
 */
const crossOriginIsolation = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: crossOriginIsolation }];
  },
  // トップはホーム（ユニットの一覧）へ。ホームの本体は (game)/home にある
  async redirects() {
    return [{ source: "/", destination: "/home", permanent: false }];
  },
};

export default nextConfig;
