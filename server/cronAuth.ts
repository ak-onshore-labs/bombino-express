/**
 * The bearer secret the external scheduler presents, checked once.
 *
 * Three sweeps ran on the same secret — retention, the BIA nudges, the
 * WhatsApp digest — and each had its own copy of the comparison, including its
 * own memory of why the length is checked first (`timingSafeEqual` throws on a
 * length mismatch rather than returning false).
 *
 * An unset secret is a 503, not a 401: the endpoint is not refusing this
 * caller, it is not configured to admit anyone.
 */

import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

export function cronSecretPresented(req: Request): boolean {
  const expected = process.env.WA_CRON_SECRET;
  if (!expected) return false;

  const header = req.header("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (presented.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

/** Mount in front of a sweep: 503 when unconfigured, 401 when wrong. */
export function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  if (!process.env.WA_CRON_SECRET) {
    res.status(503).json({ message: "Scheduler secret is not configured." });
    return;
  }
  if (!cronSecretPresented(req)) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  next();
}
