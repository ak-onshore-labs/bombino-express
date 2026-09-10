/**
 * The Express app, built once and handed to whoever is hosting it.
 *
 * Two hosts, and the difference between them is the whole reason this file is
 * separate from `index.ts`:
 *
 *   index.ts      a long-lived node process. Serves the client itself (Vite in
 *                 dev, `dist/public` in production) and listens on a port.
 *   api/index.ts  a Vercel serverless function. Serves no static files — the
 *                 CDN does that — and never listens.
 *
 * Nothing here touches the filesystem or binds a socket, so it is safe in both.
 * `createApp` is async because the session store has to resolve Redis first,
 * and callers must await it before handling a request.
 */

import "dotenv/config";
import { setDefaultResultOrder } from "node:dns";

// Cloud Postgres (e.g. Supabase) often resolves to IPv6 first; some networks time out on IPv6.
// Prefer IPv4 for all outbound connections in this process (Node 17+). Also applied via
// server/dns-ipv4first.mjs + NODE_OPTIONS --import so DNS order is set before any module loads.
if (typeof setDefaultResultOrder === "function") {
  setDefaultResultOrder("ipv4first");
}
import express, { type Express, type Request, Response, NextFunction } from "express";
import session from "express-session";
import cookieSession from "cookie-session";
import { registerRoutes } from "./routes.js";
import { assertDatabaseUrl, getPgPoolConfig } from "./pgPoolConfig.js";
import { warnIfPaymentsTestModeEnabled } from "./paymentsTestMode.js";
import { warnIfFixedOtpEnabled } from "./otp.js";
import { warnIfOcrBypassEnabled } from "./cashfreeOcr.js";
import { warnIfIdentityBypassEnabled } from "./cashfreeIdentity.js";
import { warnIfDocketAtBookingEnabled } from "./docketAtBooking.js";
import { assertFieldCryptoConfigured } from "./fieldCrypto.js";
import { createServer, type Server } from "http";


// ─── Session + Auth ───────────────────────────────────────────────────────────
const REDIS_READY_WAIT_MS = 5000; // > redis socket.connectTimeout (3000)

async function waitForRedisReady(
  client: {
    isReady: boolean;
    isOpen: boolean;
    on(event: "ready", listener: () => void): void;
    off(event: "ready", listener: () => void): void;
  },
  timeoutMs = REDIS_READY_WAIT_MS
): Promise<boolean> {
  if (client.isReady) return true;

  return new Promise((resolve) => {
    const onReady = () => {
      cleanup();
      resolve(true);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      client.off("ready", onReady);
    };
    client.on("ready", onReady);
  });
}

function makeSessionStoreFailOpen(base: session.Store): session.Store {
  base.on("error", (err: Error) =>
    console.warn("[session] store error (non-fatal):", err?.message ?? err));

  const origGet = base.get.bind(base);
  base.get = (sid, cb) =>
    origGet(sid, (err, sess) => {
      if (err) {
        console.warn("[session] get failed, treating as no session:", err.message);
        return cb(null, null);
      }
      cb(null, sess);
    });

  const origSet = base.set.bind(base);
  base.set = (sid, sess, cb) =>
    origSet(sid, sess, (err?: unknown) => {
      if (err) console.warn("[session] set failed:", String(err));
      if (cb) cb();
    });

  if (typeof base.touch === "function") {
    const origTouch = base.touch.bind(base);
    base.touch = (sid, sess, cb) =>
      origTouch(sid, sess, (err?: unknown) => {
        if (err) console.warn("[session] touch failed:", String(err));
        if (cb) cb();
      });
  }

  return base;
}

/**
 * Sessions in Postgres, using the database the app already has.
 *
 * This is the fallback that matters on a serverless host. MemoryStore lives
 * inside one container and Vercel hands you a different container whenever it
 * likes, so a user signs in on one and is a stranger to the next — which reads
 * as "the login page bounced me back". Postgres is already configured, already
 * holds the data, and needs no second service.
 *
 * `createTableIfMissing` writes the `session` table on first boot, so there is
 * nothing to migrate by hand.
 *
 * Returns undefined if there is no usable DATABASE_URL, which leaves
 * MemoryStore — fine for `npm run dev`, broken on serverless, and the caller
 * says so.
 */
async function buildPgSessionStore(): Promise<session.Store | undefined> {
  try {
    assertDatabaseUrl();
  } catch {
    return undefined;
  }

  try {
    const { default: connectPgSimple } = await import("connect-pg-simple");
    const { default: pg } = await import("pg");

    const PgStore = connectPgSimple(session);
    const pool = new pg.Pool(
      getPgPoolConfig({
        // A serverless container handles one request at a time and is frozen
        // between them; a big pool would just hold connections open against
        // Supabase for nothing.
        max: 2,
        idleTimeoutMillis: 10_000,
      })
    );

    // Prove the connection before handing this back. `new PgStore` never talks
    // to the database, so a wrong DATABASE_URL produces a store that looks fine
    // and fails on every read — which is indistinguishable, from the browser,
    // from having no session at all. Better to find out here and fall through
    // to cookies.
    await pool.query("select 1");

    const store = new PgStore({
      pool,
      tableName: "session",
      createTableIfMissing: true,
      // Cleaning up expired rows on a serverless boot is wasted work — one
      // container in ten thousand would run it. Do it in SQL if it ever matters.
      pruneSessionInterval: false,
    });

    console.log("[session] using PostgresStore");
    return makeSessionStoreFailOpen(store as unknown as session.Store);
  } catch (e) {
    console.warn("[session] PostgresStore init failed:", e);
    return undefined;
  }
}

async function buildSessionStore(): Promise<session.Store | undefined> {
  if (!process.env.REDIS_URL) {
    return buildPgSessionStore();
  }

  try {
    const { RedisStore } = await import("connect-redis");
    const { default: client } = await import("./redisClient.js");

    const ready = await waitForRedisReady(client);
    if (!ready) {
      // A REDIS_URL that does not answer is the common case on a fresh deploy —
      // `redis://localhost:6379` copied out of .env.example, pointing at a
      // machine that is not there. Fall through to Postgres rather than to
      // MemoryStore, which would silently break every login.
      console.warn(
        `[session] Redis not ready within ${REDIS_READY_WAIT_MS}ms ` +
          `(isOpen=${client.isOpen}, isReady=${client.isReady}) — falling back to Postgres`
      );
      return buildPgSessionStore();
    }

    const baseStore = new RedisStore({ client });
    console.log("[session] using RedisStore");
    return makeSessionStoreFailOpen(baseStore);
  } catch (e) {
    console.warn("[session] RedisStore init failed, falling back to Postgres:", e);
    return buildPgSessionStore();
  }
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

/** One line per API request, with the JSON it answered. */
function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (path === "/api/support/chat") {
        logLine += " :: [redacted]";
      } else if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
}

/**
 * Sessions with no server behind them: the whole session rides in a signed
 * cookie.
 *
 * The last resort, and on a serverless host usually the right one. Redis and
 * Postgres both have to be reachable and correctly credentialed; a cookie has
 * to be nothing. Since Vercel hands each request to whichever container it
 * likes, a store that needs neither is the only one that cannot silently
 * degrade into "signed in, then bounced back to the login page".
 *
 * Two things to know about it:
 *
 *   · The payload is signed, not encrypted. The browser can read it. That is
 *     fine for a user id and a role; it means an ITD bearer token in
 *     `itdToken` would be readable too, which is why this is the fallback and
 *     not the default — an environment with real ITD logins should give Redis
 *     or Postgres a working URL and get a server-side store.
 *   · Cookies cap at ~4KB. The session here is a user record and two ids, well
 *     inside that.
 *
 * `cookie-session` gives a plain object where `express-session` gives a Session
 * instance, so `save`, `destroy` and `sessionID` are shimmed onto it — eight
 * call sites use them and none should have to care which store is underneath.
 * They are defined non-enumerable so they never end up serialised into the
 * cookie.
 */
function cookieBackedSession(): express.RequestHandler {
  const inner = cookieSession({
    name: "bombino.sid",
    keys: [process.env.SESSION_SECRET ?? "dev-secret"],
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });

  return (req, res, next) => {
    inner(req, res, () => {
      const bag = req.session as unknown as Record<string, unknown> | null;

      if (bag && typeof bag.save !== "function") {
        // Nothing to flush: cookie-session writes the header on response end.
        Object.defineProperty(bag, "save", {
          value: (cb?: (err?: unknown) => void) => cb?.(null),
          enumerable: false,
        });
        Object.defineProperty(bag, "destroy", {
          value: (cb?: (err?: unknown) => void) => {
            (req as unknown as { session: unknown }).session = null;
            cb?.(null);
          },
          enumerable: false,
        });
      }

      if (!req.sessionID) {
        Object.defineProperty(req, "sessionID", {
          value: "cookie",
          configurable: true,
        });
      }

      next();
    });
  };
}

/**
 * Build the app. Call once per process and reuse the result.
 *
 * The `httpServer` is created but never listened on here. `registerRoutes`
 * takes one and hands it back; on a serverless host nothing ever binds it, and
 * that is fine — it exists so the signature holds for both hosts.
 */
export async function createApp(): Promise<{ app: Express; httpServer: Server }> {
  const app = express();
  // Behind Vercel's proxy (and any other), so req.protocol and the secure
  // cookie flag read the forwarded headers rather than the socket.
  app.set("trust proxy", 1);
  const httpServer = createServer(app);

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false }));
  app.use(requestLogger);

  const sessionStore = await buildSessionStore();

  if (sessionStore) {
    app.use(
      session({
        store: sessionStore,
        secret: process.env.SESSION_SECRET ?? "dev-secret",
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        },
      }),
    );
  } else {
    // No Redis, no Postgres. MemoryStore would "work" and then lose the session
    // on the next request to a different container, which looks like a bug in
    // the login page rather than a missing service. The cookie always works.
    console.log("[session] no server store available — using signed cookies");
    app.use(cookieBackedSession());
  }

  // Before anything can serve a request. Identity documents cannot be written
  // without a key, and the failure this prevents is a deploy that looks healthy
  // while quietly refusing every upload — or worse, an older build that stored
  // them in the clear. Dying at boot is the loud version.
  assertFieldCryptoConfigured();

  warnIfPaymentsTestModeEnabled();
  warnIfOcrBypassEnabled();
  warnIfIdentityBypassEnabled();
  warnIfFixedOtpEnabled();
  warnIfDocketAtBookingEnabled();

  await registerRoutes(httpServer, app);

  // Anything under /api that no route matched. Without this the request falls
  // through to whatever sits behind the API, and none of those answer in JSON:
  // standalone dev hands it to the Vite catch-all, which returns the SPA shell
  // at status 200; production hands it to Express's own finalhandler, which
  // returns an HTML error page. Either way the client calls res.json() on
  // "<!DOCTYPE html>" and reports a JSON syntax error instead of the 404 that
  // actually happened.
  app.use("/api", (req: Request, res: Response) => {
    res
      .status(404)
      .json({ message: `No such endpoint: ${req.method} ${req.originalUrl}` });
  });

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    // A thrown body-parser error arrives here with the response already
    // started. Writing a second time throws, so hand it back to Express.
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err?.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ message: "File too large. Maximum size is 4MB." });
      return;
    }
    if (err?.message?.includes("Only PDF")) {
      res.status(400).json({ message: err.message });
      return;
    }
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Logged, not rethrown. Throwing from an error middleware after responding
    // sends the error on to finalhandler with the headers already gone, which
    // destroys the socket mid-body — the client sees a truncated response and
    // fails to parse it, hiding the real error behind a parse error.
    console.error("[error]", status, message, err);
    res.status(status).json({ message });
  });

  return { app, httpServer };
}
