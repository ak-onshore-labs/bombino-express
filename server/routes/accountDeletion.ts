/**
 * In-app account deletion endpoints.
 *
 *   GET  /api/account/delete/preflight
 *   POST /api/account/delete           { code }
 *   GET  /api/guest/delete/preflight
 *   POST /api/guest/delete             { code }
 *
 * OTP is issued via the existing /api/auth/otp/request (purpose "auth") and
 * consumed here in the same request as the deletion.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  buildPreflight,
  guestSubject,
  loadAccountSubject,
  runAccountDeletion,
} from "../accountDeletion.js";
import { consumeOtp } from "../otpVerify.js";
import {
  asyncRoutes,
  ensureDbUser,
  requireUser,
  requireUserOrGuest,
} from "../routeGuards.js";

const codeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

function destroySession(req: Request, res: Response, body: unknown): void {
  req.session.destroy((err) => {
    if (err) {
      console.error("[accountDeletion] session destroy failed:", err);
      // Deletion already committed — still tell the client it worked.
    }
    res.json(body);
  });
}

export function registerAccountDeletionRoutes(app: Express): void {
  const routes = asyncRoutes(app);

  routes.get(
    "/api/account/delete/preflight",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const userId = req.session.dbUserId;
      if (!userId) {
        res.status(401).json({ message: "Login required" });
        return;
      }
      const loaded = await loadAccountSubject(userId);
      if (!loaded.ok) {
        res.status(loaded.status).json({ message: loaded.message, code: loaded.code });
        return;
      }
      const preflight = await buildPreflight(loaded.subject);
      res.json(preflight);
    }
  );

  routes.post(
    "/api/account/delete",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const userId = req.session.dbUserId;
      if (!userId) {
        res.status(401).json({ message: "Login required" });
        return;
      }

      const parsed = codeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
          code: "INVALID_REQUEST",
        });
        return;
      }

      const loaded = await loadAccountSubject(userId);
      if (!loaded.ok) {
        res.status(loaded.status).json({ message: loaded.message, code: loaded.code });
        return;
      }

      const otp = await consumeOtp(loaded.subject.phone, "auth", parsed.data.code);
      if (!otp.ok) {
        res.status(otp.status).json({ message: otp.message, code: otp.code });
        return;
      }

      const result = await runAccountDeletion(loaded.subject);
      if (!result.ok) {
        res.status(result.status).json({
          message: result.message,
          code: result.code,
          blockers: result.blockers,
        });
        return;
      }

      destroySession(req, res, { deleted: true });
    }
  );

  routes.get(
    "/api/guest/delete/preflight",
    requireUserOrGuest,
    async (req: Request, res: Response) => {
      if (req.session.user) {
        res.status(403).json({
          message: "Signed-in accounts delete from Profile, not as a guest.",
          code: "FORBIDDEN",
        });
        return;
      }
      const guestRef = req.session.guestRef;
      const phone = req.session.guestPhone;
      if (!guestRef || !phone) {
        res.status(401).json({ message: "Verify your phone number first" });
        return;
      }
      const preflight = await buildPreflight(guestSubject(guestRef, phone));
      res.json(preflight);
    }
  );

  routes.post(
    "/api/guest/delete",
    requireUserOrGuest,
    async (req: Request, res: Response) => {
      if (req.session.user) {
        res.status(403).json({
          message: "Signed-in accounts delete from Profile, not as a guest.",
          code: "FORBIDDEN",
        });
        return;
      }
      const guestRef = req.session.guestRef;
      const phone = req.session.guestPhone;
      if (!guestRef || !phone) {
        res.status(401).json({ message: "Verify your phone number first" });
        return;
      }

      const parsed = codeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
          code: "INVALID_REQUEST",
        });
        return;
      }

      const otp = await consumeOtp(phone, "auth", parsed.data.code);
      if (!otp.ok) {
        res.status(otp.status).json({ message: otp.message, code: otp.code });
        return;
      }

      const result = await runAccountDeletion(guestSubject(guestRef, phone));
      if (!result.ok) {
        res.status(result.status).json({
          message: result.message,
          code: result.code,
          blockers: result.blockers,
        });
        return;
      }

      destroySession(req, res, { deleted: true });
    }
  );
}
