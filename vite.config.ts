import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { metaImagesPlugin } from "./vite-plugin-meta-images";

// Which build is running, baked in at build time (client/src/lib/buildInfo.ts).
// Railway sets RAILWAY_GIT_COMMIT_SHA itself; locally the commit comes from git.
function buildCommit(): string {
  const fromRailway = process.env.RAILWAY_GIT_COMMIT_SHA;
  if (fromRailway) return fromRailway.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

// Which deploy this is, bumped by `npm run build:next` (scripts/next-build.mjs).
const build: { major: number; total: number; date: string; number: number } = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "build.json"), "utf-8"),
);

export default defineConfig({
  define: {
    __BUILD_MAJOR__: JSON.stringify(build.major),
    __BUILD_TOTAL__: JSON.stringify(build.total),
    __BUILD_DATE__: JSON.stringify(build.date),
    __BUILD_NUMBER__: JSON.stringify(build.number),
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
  },
  plugins: [
    react(),
    runtimeErrorOverlay(),
    tailwindcss(),
    metaImagesPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    // Compile the app while the server starts, not on the first page load:
    // otherwise the first load after every restart sits blank for ~30s while
    // ~250 modules are transformed one request at a time. The entry pulls in
    // everything it imports; pages are listed too in case a route loads lazily.
    // (server/vite.ts passes this through; it replaces the rest of `server`.)
    warmup: {
      clientFiles: ["./src/main.tsx", "./src/pages/**/*.tsx"],
    },
  },
});
