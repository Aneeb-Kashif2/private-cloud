import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function nextConfig(phase: string): NextConfig {
  return {
    output: "standalone",
    // Direct next dev access also works from phones: the browser stays same-origin.
    async rewrites() {
      return [{ source: "/api/:path*", destination: "http://127.0.0.1:4000/api/:path*" }];
    },
    outputFileTracingRoot: path.join(__dirname, ".."),
    // Production builds must not overwrite a running development server's chunks.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  };
}
