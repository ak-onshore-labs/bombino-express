/**
 * Request guards shared by every route module.
 *
 * These lived inside `routes.ts` until A5 needed them from `routes/agent.ts`.
 * Importing them back out of `routes.ts` would make the two files circular, so
 * they live here instead. Behaviour is unchanged from the originals — a
 * verbatim move.
 */

import type { NextFunction, Request, Response } from "express";
import { findItdUserIdByCustomerId } from "./appDb.js";

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
