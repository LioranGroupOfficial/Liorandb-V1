import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  "output": "export",
  "images": {
    "unoptimized": true
  },
  turbopack: {
    root: __dirname,
  },
  typescript: {
    // The template is often built in sandboxed / locked-down environments (CI, Tauri, etc.).
    // We run `tsc --noEmit` separately; this avoids Next trying to spawn its own typecheck worker.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
