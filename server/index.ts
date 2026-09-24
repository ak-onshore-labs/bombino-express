import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";

// Cloud Postgres (e.g. Supabase) often resolves to IPv6 first; some networks time out on IPv6.
// Prefer IPv4 for all outbound connections in this process (Node 17+). Also applied via
// server/dns-ipv4first.mjs + NODE_OPTIONS --import so DNS order is set before any module loads.
if (typeof setDefaultResultOrder === "function") {
  setDefaultResultOrder("ipv4first");
}

import { createApp, log } from "./app.js";
import { serveStatic } from "./static.js";

/**
 * The standalone server: one node process that serves the API and the client
 * and listens on a port. This is `npm run dev` and `npm start`.
 *
 * Vercel does not run this file — it calls `api/index.ts`, which builds the
 * same app and lets the CDN serve the client. Anything added here that the
 * hosted app also needs belongs in `server/app.ts` instead.
 */
(async () => {
  const { app, httpServer } = await createApp();

  // Importantly only after every other route is registered, so the catch-all
  // does not swallow them.
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite.js");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  const port = parseInt(process.env.PORT || "5000", 10);

  // reusePort is only supported on Linux - use explicit runtime check
  // Store platform in a variable to prevent esbuild from optimizing it away
  const isLinux = process.platform === "linux";
  const listenOptions: { port: number; host: string; reusePort?: boolean } = {
    port,
    host: "0.0.0.0",
    ...(isLinux && { reusePort: true }),
  };

  httpServer
    .listen(listenOptions, () => {
      log(`serving on port ${port}`);
    })
    .on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        log(`Port ${port} is already in use`, "error");
      } else if (err.code === "ENOTSUP") {
        log(
          `Socket option not supported: ${err.message}. This may occur if reusePort is used on non-Linux systems.`,
          "error",
        );
      } else {
        log(`Server error: ${err.message}`, "error");
      }
      process.exit(1);
    });
})().catch((err: unknown) => {
  // A boot that cannot finish — no SESSION_SECRET, no session store, no
  // ENCRYPTION_KEY — must end the process. The process guards would otherwise
  // log the rejection and keep an empty process alive with nothing listening,
  // which a host reads as "starting" rather than "failed".
  console.error("[boot] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
