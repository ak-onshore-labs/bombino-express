/**
 * Request guards shared by every route module.
 *
 * These lived inside `routes.ts` until A5 needed them from `routes/agent.ts`.
 * Importing them back out of `routes.ts` would make the two files circular, so
 * they live here instead. Behaviour is unchanged from the originals — a
 * verbatim move.
 */

import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { findItdUserIdByCustomerId, getIsActiveById, getStaffAccessById } from "./appDb.js";
import { can, isCityScoped, isOpsRole, type OpsPermission } from "../shared/staffAccess.js";
import { hubCityForId } from "../shared/hubs.js";

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
 * The ops console's gate: a signed-in, active ops staff member holding at least
 * one of `permissions` (shared/staffAccess.ts).
 *
 *   app.get("/api/ops/payments", ...opsGateFor("payments.view"), handler);
 *
 * `requireUser` first, so a missing session is a 401 rather than a 403. The
 * role is read from the database on every request, not from the session, so a
 * super admin changing someone's role or deactivating them takes effect on
 * their next click rather than their next login.
 */
export function opsGateFor(...permissions: OpsPermission[]) {
  return [requireUser, ensureDbUser, loadOpsStaff, requirePermission(...permissions)] as const;
}

/**
 * Reads the caller's role, active flag and hub into `req.staff`.
 *
 * Refuses anyone who is not ops staff, and ops staff who have been
 * deactivated. Keeps `session.user.role` in step with the database so the
 * client's next /api/auth/me shows the new role.
 */
export async function loadOpsStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  const dbUserId = req.session.dbUserId;
  if (!dbUserId) {
    res.status(401).json({ message: "Login required" });
    return;
  }

  const access = await getStaffAccessById(dbUserId);
  if (!access) {
    res.status(503).json({ message: "Could not check your access. Please try again." });
    return;
  }
  if (!isOpsRole(access.role)) {
    res.status(403).json({
      message: "You do not have permission to perform this action.",
      code: "FORBIDDEN",
    });
    return;
  }
  if (!access.is_active) {
    res.status(403).json({
      code: "ACCOUNT_DEACTIVATED",
      message: "This account has been deactivated. Please contact your admin.",
    });
    return;
  }

  if (req.session.user && req.session.user.role !== access.role) {
    req.session.user.role = access.role;
  }
  const scoped = isCityScoped(access.role);
  req.staff = { role: access.role, scoped, city: scoped ? hubCityForId(access.hub_id) : null };
  next();
}

/**
 * `loadOpsStaff` for ops callers only, on routes customers and agents share
 * (the order lifecycle endpoint). Anyone else passes through untouched.
 */
export async function loadOpsStaffIfOps(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!isOpsRole(req.session.user?.role)) {
    next();
    return;
  }
  await loadOpsStaff(req, res, next);
}

/** Any one of `permissions`. Mount behind `loadOpsStaff`. */
export function requirePermission(...permissions: OpsPermission[]) {
  return function permissionGuard(req: Request, res: Response, next: NextFunction): void {
    const role = req.staff?.role;
    if (!role || !permissions.some((p) => can(role, p))) {
      res.status(403).json({
        message: "You do not have permission to perform this action.",
        code: "FORBIDDEN",
        requiredPermission: permissions,
      });
      return;
    }
    next();
  };
}

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

/**
 * Kills a deactivated agent's live session on the next request.
 *
 * Non-agents pass through so this can sit on the shared order-actions route.
 * Customers are never gated here. `is_active` other than explicit false is live.
 */
export async function requireActiveAgent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.session.user?.role !== "agent") {
    next();
    return;
  }

  const dbUserId = req.session.dbUserId;
  if (!dbUserId) {
    res.status(401).json({ message: "Login required" });
    return;
  }

  const active = await getIsActiveById(dbUserId);
  if (active === false) {
    res.status(403).json({
      code: "ACCOUNT_DEACTIVATED",
      message: "This account has been deactivated. Please contact ops.",
    });
    return;
  }

  next();
}
