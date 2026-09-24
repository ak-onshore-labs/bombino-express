import type { IncomingMessage, ServerResponse } from "http";
import { createApp } from "../server/app.js";

/**
 * The whole API as one Vercel serverless function.
 *
 * `vercel.json` rewrites every `/api/*` path here; the client is static and
 * comes off the CDN, so this function never serves a file. Express still does
 * its own routing inside — the rewrite hands it the original URL.
 *
 * One function rather than a file per route, deliberately: `registerRoutes`
 * builds the entire router in one pass and the state machine in `routes.ts`
 * assumes it. Splitting it would mean booting the session store and the
 * Supabase client separately in every one.
 *
 * THE APP IS BUILT ONCE PER CONTAINER, not once per request. A warm invocation
 * reuses it; a cold one pays for the Postgres connect. The promise is cached
 * rather than the app so that two requests arriving during a cold start share
 * one boot instead of racing to build two.
 */
let booting: ReturnType<typeof createApp> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!booting) booting = createApp();
  const { app } = await booting;
  return app(req as never, res as never);
}
