import type { NextConfig } from "next";

/**
 * In development we run `next dev` on :3000 and proxy `/api/*` to the FastAPI
 * backend on :8000, so the browser only ever sees same-origin relative paths.
 *
 * For the production build we emit a fully static export to `out/`, which the
 * Dockerfile copies into `backend/static`. Rewrites do not exist in a static
 * export, and none are needed: FastAPI serves the API and the static files from
 * the same origin.
 */
const isDev = process.env.NODE_ENV === "development";

const devApiTarget = process.env.DEV_API_TARGET ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  output: isDev ? undefined : "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  ...(isDev
    ? {
        async rewrites() {
          return [
            { source: "/api/:path*", destination: `${devApiTarget}/api/:path*` },
          ];
        },
      }
    : {}),
};

export default nextConfig;
