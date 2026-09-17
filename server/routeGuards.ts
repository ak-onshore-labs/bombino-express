/**
 * Request guards shared by every route module.
 *
 * These lived inside `routes.ts` until A5 needed them from `routes/agent.ts`.
 * Importing them back out of `routes.ts` would make the two files circular, so
 * they live here instead. Behaviour is unchanged from the originals — a
 * verbatim move.
 */

import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { findItdUserIdByCustomerId } from "./appDb.js";

/**
 * An async handler whose rejection reaches the error middleware.
 *
 * Express 4 does not await a handler: a rejected promise is nobody's, so the
 * request hangs until the client gives up and — since Node 15 — the unhandled
 * rejection takes the process with it. On Vercel that is every other request in
 * the same container.
 *
 * Wrap any `async` handler that calls something which throws rather than
 * returning null: ITD, Razorpay, nodemailer, crypto. `server/app.ts` turns what
 * arrives into a 500 JSON body.
 */
export function asyncRoute(handler: RequestHandler): RequestHandler {
  return function wrapped(req: Request, res: Response, next: NextFunction): void {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Every route a module mounts, with `asyncRoute` already applied.
 *
 *   const routes = asyncRoutes(app);
 *   routes.get("/api/thing", requireUser, async (req, res) => { ... });
 *
 * One line per module instead of a wrapper around every handler, so a route
 * added later cannot forget it.
 */
export type AsyncRouter = {
  get(path: string, ...handlers: RequestHandler[]): void;
  post(path: string, ...handlers: RequestHandler[]): void;
  put(path: string, ...handlers: RequestHandler[]): void;
  patch(path: string, ...handlers: RequestHandler[]): void;
  delete(path: string, ...handlers: RequestHandler[]): void;
};

export function asyncRoutes(app: Express): AsyncRouter {
  const mount =
    (verb: keyof AsyncRouter) =>
    (path: string, ...handlers: RequestHandler[]): void => {
      app[verb](path, ...handlers.map(asyncRoute));
    };
  return {
    get: mount("get"),
    post: mount("post"),
    put: mount("put"),
    patch: mount("patch"),
    delete: mount("delete"),
  };
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  next();
}

/**
 * An account OR a guest holding a verified phone.
 *
 * A guest booking deliberately has no `session.user` — that is the whole point
 * of it — but it does get `session.guestRef` minted at order creation, and the
 * customer still has to be able to pay for the order they just placed. Routes
 * that serve both mount this instead of `requireUser`.
 *
 * It proves only that SOMEONE identifiable is asking. It says nothing about
 * what they may touch: every route behind it still resolves the caller and
 * checks the order belongs to them (`paymentCaller` / `ownsOrder` in
 * server/routes/payments.ts). Never use this where ownership is not checked
 * downstream.
 */
export function requireUserOrGuest(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user && !req.session.guestRef) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  next();
}

/**
 * Role gate. Interim stand-in for M1's `requireRole` — same signature and the
 * same 403 body shape, so swapping in the real one is an import change.
 *
 * Roles are a strict allowlist: `req.session.user.role` is whatever ITD sent
 * for password logins and a Bombino literal ("customer") for OTP signups, so
 * anything unrecognised must fall through to 403 rather than be trusted.
 * Always mount behind `requireUser` — a missing session is a 401, not a 403.
 */
export function requireRole(...roles: string[]) {
  return function roleGuard(req: Request, res: Response, next: NextFunction): void {
    const role = req.session.user?.role;
    if (!role || !roles.includes(role)) {
      res.status(403).json({
        message: "You do not have permission to perform this action.",
        code: "FORBIDDEN",
        requiredRole: roles,
      });
      return;
    }
    next();
  };
}

/**
 * The ops console's gates, as two values instead of twenty spellings.
 *
 * `requireUser` first, so a missing session is a 401 rather than a 403.
 * `super_admin` is listed explicitly because `requireRole("admin")` is an exact
 * match, not a rank.
 *
 * `opsDbGate` is the same with `ensureDbUser`, for handlers that need the row
 * id — recording who approved something, or who looked at a document.
 */
export const opsGate = [requireUser, requireRole("admin", "super_admin")] as const;

export const opsDbGate = [requireUser, ensureDbUser, requireRole("admin", "super_admin")] as const;

export async function ensureDbUser(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (req.session.dbUserId || !req.session.user) {
    next();
    return;
  }

  try {
    const row = await findItdUserIdByCustomerId(req.session.user.id);

    if (!row?.id) {
      console.error(
        `[ensureDbUser] no itd_users row found for itd_customer_id=${req.session.user.id}`
      );
      next();
      return;
    }

    req.session.dbUserId = row.id;
    req.session.save((err) => {
      if (err) {
        console.error("[ensureDbUser] session save error:", err);
      }
      next();
    });
  } catch (err) {
    console.error("[ensureDbUser] failed:", err);
    next();
  }
}
