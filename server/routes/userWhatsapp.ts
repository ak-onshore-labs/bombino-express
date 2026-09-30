/**
 * "Verify WhatsApp" — the profile button for a number last seen with no
 * WhatsApp on it.
 *
 * Every login sends the code on WhatsApp as well as by SMS, and the WhatsApp
 * receipt is how we learn a number is not on WhatsApp (whatsappDb
 * §Reachability). Once it is marked that way, order and agent messages to it
 * stop. This is how the customer turns them back on: we send a code on
 * WhatsApp ONLY — never MSG91 — and typing it back proves it arrived there.
 *
 * The phone is always the account's own, read from the profile. Neither route
 * accepts one in the body; that would let a caller mark someone else's number.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { asyncRoutes, ensureDbUser, requireUser } from "../routeGuards.js";
import { getItdUserProfileById } from "../appDb.js";
import {
  generateOtp,
  hashOtp,
  otpDedupeKey,
  OTP_MAX_REQUESTS_PER_HOUR,
  OTP_TTL_MINUTES,
} from "../otp.js";
import { countRecentRequests, insertOtpCode } from "../otpDb.js";
import { consumeOtp } from "../otpVerify.js";
import { sendTemplate } from "../whatsapp.js";
import { markWhatsappVerified } from "../whatsappDb.js";
import { loginOtpMessage } from "../whatsappTemplates.js";

async function accountPhone(req: Request): Promise<string | null> {
  if (!req.session.dbUserId) return null;
  const profile = await getItdUserProfileById(req.session.dbUserId);
  const phone = profile?.phone ? String(profile.phone).trim() : "";
  return phone || null;
}

export function registerUserWhatsappRoutes(app: Express): void {
  const routes = asyncRoutes(app);

  // POST /api/user/whatsapp/verify/request
  routes.post(
    "/api/user/whatsapp/verify/request",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const phone = await accountPhone(req);
      if (!phone) {
        res.status(400).json({ message: "Add a phone number first.", code: "NO_PHONE" });
        return;
      }

      // Same ceiling as the login code, and counted together with it: both are
      // rows in otp_codes for this number.
      const recent = await countRecentRequests(phone, 60);
      if (recent !== null && recent >= OTP_MAX_REQUESTS_PER_HOUR) {
        res.status(429).json({
          message: "Too many codes requested. Please try again later.",
          code: "OTP_RATE_LIMITED",
        });
        return;
      }

      const code = generateOtp();
      const inserted = await insertOtpCode({
        phone,
        code_hash: hashOtp(code),
        purpose: "whatsapp_verify",
        expires_at: new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString(),
      });
      if (!inserted) {
        res.status(502).json({ message: "Could not send the code. Please try again.", code: "OTP_SEND_FAILED" });
        return;
      }

      if (process.env.NODE_ENV === "development") {
        console.log(`[whatsapp-verify] code for ${phone}: ${code}`);
      }

      // Same approved Authentication template as the login code — Meta fixes
      // its wording anyway, and it is the template reachability reads, so the
      // receipt of this send updates the number's status by itself.
      const message = loginOtpMessage(code);
      const sent = await sendTemplate({
        to: phone,
        template: message.template,
        variables: message.variables,
        otpButtonCode: message.otpButtonCode,
        dedupeKey: otpDedupeKey(inserted.id, "wa-verify"),
        userId: req.session.dbUserId ?? null,
        redactVariables: true,
        skipReachabilityCheck: true,
      });

      // `skipped` is dry run / no token: a configuration state, and in
      // development the code is in the log above.
      if (!sent.ok && sent.reason !== "skipped") {
        res.status(502).json({
          message: "Couldn't reach this number on WhatsApp. Please try again.",
          code: "WHATSAPP_SEND_FAILED",
        });
        return;
      }
      res.json({ message: "Code sent on WhatsApp" });
    }
  );

  // POST /api/user/whatsapp/verify/confirm
  routes.post(
    "/api/user/whatsapp/verify/confirm",
    requireUser,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const parsed = z
        .object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
        return;
      }

      const phone = await accountPhone(req);
      if (!phone || !req.session.dbUserId) {
        res.status(400).json({ message: "Add a phone number first.", code: "NO_PHONE" });
        return;
      }

      const result = await consumeOtp(phone, "whatsapp_verify", parsed.data.code);
      if (!result.ok) {
        res.status(result.status).json({ message: result.message, code: result.code });
        return;
      }

      const saved = await markWhatsappVerified(req.session.dbUserId);
      if (!saved) {
        res.status(502).json({ message: "Could not save that. Please try again.", code: "SAVE_FAILED" });
        return;
      }
      res.json({ whatsapp: "on_whatsapp" });
    }
  );
}
