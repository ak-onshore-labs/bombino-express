import { createClient } from "redis";

/**
 * Shared Redis client — the session store, the postal-lookup cache and the
 * support rate limiter all reach for this one.
 *
 * Two guards, both learned the hard way:
 *
 * `connect()` only runs when REDIS_URL is set. `postalLookup` and
 * `supportRateLimit` import this module at load time, so without the guard a
 * host with no local Redis (Railway) spends its whole life looping on
 * ECONNREFUSED to redis://localhost:6379 — and the session store spends five
 * seconds of every cold start waiting for a socket that will never open.
 * Consumers already degrade through `isReady`, so not connecting is a
 * supported state rather than a failure.
 *
 * The 'error' listener is not optional. A node-redis client is an EventEmitter,
 * and an 'error' event with no listener is rethrown — so a cache that dies
 * mid-request would take the process down with it.
 *
 * It logs at most once per minute. A client that cannot reach its server
 * retries forever, and one line per attempt buries every other log on the box —
 * which is its own kind of outage when you are trying to read why sessions
 * stopped working.
 */
const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 3000,
    family: 0, // allow IPv6 (redis.railway.internal) under ipv4-first DNS
  },
});

/**
 * node-redis reports a refused socket as an AggregateError whose own `message`
 * is the empty string — the reason lives on `errors[]` or on `code`. Printing
 * `err.message` alone gives a log full of "[redisClient] error:" and nothing
 * else, which is how a misconfigured REDIS_URL stays invisible.
 */
function describeRedisError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as { message?: string; code?: string; errors?: unknown[] };
  const parts = [e.code, e.message?.trim()].filter(Boolean);
  if (parts.length === 0 && Array.isArray(e.errors)) {
    const inner = e.errors[0] as { message?: string; code?: string } | undefined;
    if (inner) parts.push(inner.code ?? "", inner.message?.trim() ?? "");
  }
  const described = parts.filter(Boolean).join(" ");
  return described || String(err);
}

const ERROR_LOG_INTERVAL_MS = 60_000;
let lastErrorLoggedAt = 0;

redisClient.on("error", (err) => {
  const now = Date.now();
  if (now - lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return;
  lastErrorLoggedAt = now;
  console.error("[redisClient] error:", describeRedisError(err));
});

if (process.env.REDIS_URL) {
  redisClient.connect().catch((err) => {
    console.error("[redisClient] connection failed:", err);
  });
} else {
  console.log("[redisClient] REDIS_URL not set — not connecting");
}

export default redisClient;
