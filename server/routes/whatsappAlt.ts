/**
 * The Indian WhatsApp number for a customer who signs in from abroad.
 *
 *   GET    /api/whatsapp/alt           where updates go, and whether to ask for one
 *   POST   /api/whatsapp/alt/request   send a code on WhatsApp to the Indian number
 *   POST   /api/whatsapp/alt/confirm   type it back; the number is saved
 *   DELETE /api/whatsapp/alt           stop using it
 *
 * For accounts and guests alike. The sign-in number is always the session's
 * own, never the body's: that would let a caller point someone else's updates
 * at a number of their choosing. The rule for which number a message goes to
 * lives in server/whatsappAlt.ts.
 *
 * The code goes out on WhatsApp ONLY, never by SMS. Typing it back is the
 * proof that this Indian number is on WhatsApp, which is the whole point of it.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { asyncRoutes } from "../routeGuards.js";
import { getItdUserProfileById } from "../appDb.js";
import { ownerFrom, OWNER_PROFILES } from "../sessionOwner.js";
import {
  generateOtp,
  hashOtp,
  isTestOtpNumber,
  otpDedupeKey,
  OTP_MAX_REQUESTS_PER_HOUR,
  OTP_TTL_MINUTES,
} from "../otp.js";
import { countRecentRequests, insertOtpCode } from "../otpDb.js";
import { consumeOtp } from "../otpVerify.js";
import { sendTemplate } from "../whatsapp.js";
import { loginOtpMessage } from "../whatsappTemplates.js";
import {
  chooseWhatsappTarget,
  clearWhatsappAltPhone,
  getWhatsappAltPhone,
  setWhatsappAltPhone,
  whatsappReachOf,
} from "../whatsappAlt.js";
import {
  INDIAN_MOBILE_MESSAGE,
  isIndianMobile,
  isInternationalPhone,
  toIndianMobile,
} from "../../shared/contact.js";

/** The session's own sign-in number: the account's, else the verified guest's. */
async function ownPhone(req: Request): Promise<string | null> {
  const owner = ownerFrom(req, OWNER_PROFILES.nudges);
  if (!owner) return null;
  if (owner.kind === "guest") return owner.phone?.trim() || null;
  const profile = await getItdUserProfileById(owner.userId);
  const phone = profile?.phone ? String(profile.phone).trim() : "";
  return phone || null;
}

const altPhoneSchema = z
  .string()
  .transform((v) => toIndianMobile(v))
  .refine((v) => isIndianMobile(v) && /^[6-9]/.test(v), INDIAN_MOBILE_MESSAGE);

export function registerWhatsappAltRoutes(app: Express): void {
  const routes = asyncRoutes(app);

  routes.get("/api/whatsapp/alt", async (req: Request, res: Response) => {
    const phone = await ownPhone(req);
    if (!phone) {
      res.status(401).json({ message: "Sign in first.", code: "NOT_SIGNED_IN" });
      return;
    }
    const international = isInternationalPhone(phone);
    if (!international) {
      // Indian numbers are never offered an alternate.
      res.json({ phone, international: false, whatsapp: null, alt_phone: null, sends_to: "own", needs_alt: false });
      return;
    }

    const [whatsapp, altPhone] = await Promise.all([whatsappReachOf(phone), getWhatsappAltPhone(phone)]);
    const target = chooseWhatsappTarget(phone, altPhone, whatsapp);
    res.json({
      phone,
      international: true,
      whatsapp,
      alt_phone: altPhone,
      sends_to: target === altPhone && altPhone ? "alt" : whatsapp === "not_on_whatsapp" ? "none" : "own",
      // Ask for one only when updates would otherwise reach nobody.
      needs_alt: whatsapp === "not_on_whatsapp" && !altPhone,
    });
  });

  routes.post("/api/whatsapp/alt/request", async (req: Request, res: Response) => {
    const phone = await ownPhone(req);
    if (!phone) {
      res.status(401).json({ message: "Sign in first.", code: "NOT_SIGNED_IN" });
      return;
    }
    if (!isInternationalPhone(phone)) {
      res.status(400).json({ message: "Your number is already Indian.", code: "NOT_INTERNATIONAL" });
      return;
    }
    const parsed = z.object({ alt_phone: altPhoneSchema }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const alt = parsed.data.alt_phone;

    // Counted with every other code sent to that number.
    const recent = isTestOtpNumber(alt) ? 0 : await countRecentRequests(alt, 60);
    if (recent !== null && recent >= OTP_MAX_REQUESTS_PER_HOUR) {
      res.status(429).json({ message: "Too many codes requested. Please try again later.", code: "OTP_RATE_LIMITED" });
      return;
    }

    const code = generateOtp(alt);
    const inserted = await insertOtpCode({
      phone: alt,
      code_hash: hashOtp(code),
      // Its own purpose already: a code that proves a number is on WhatsApp,
      // and can never be spent as a sign-in.
      purpose: "whatsapp_verify",
      expires_at: new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString(),
    });
    if (!inserted) {
      res.status(502).json({ message: "Could not send the code. Please try again.", code: "OTP_SEND_FAILED" });
      return;
    }

    if (process.env.NODE_ENV === "development") {
      console.log(`[whatsapp-alt] code for ${alt}: ${code}`);
    }

    // Test numbers cannot receive anything; their code is the public one.
    if (!isTestOtpNumber(alt)) {
      const message = loginOtpMessage(code);
      const sent = await sendTemplate({
        to: alt,
        template: message.template,
        variables: message.variables,
        otpButtonCode: message.otpButtonCode,
        dedupeKey: otpDedupeKey(inserted.id, "wa-alt"),
        redactVariables: true,
        skipReachabilityCheck: true,
      });
      // `skipped` is dry run / no token: a configuration state, and in
      // development the code is in the log above.
      if (!sent.ok && sent.reason !== "skipped") {
        res.status(502).json({
          message: "Couldn't reach this number on WhatsApp. Check it and try again.",
          code: "WHATSAPP_SEND_FAILED",
        });
        return;
      }
    }
    res.json({ message: "Code sent on WhatsApp" });
  });

  routes.post("/api/whatsapp/alt/confirm", async (req: Request, res: Response) => {
    const phone = await ownPhone(req);
    if (!phone) {
      res.status(401).json({ message: "Sign in first.", code: "NOT_SIGNED_IN" });
      return;
    }
    if (!isInternationalPhone(phone)) {
      res.status(400).json({ message: "Your number is already Indian.", code: "NOT_INTERNATIONAL" });
      return;
    }
    const parsed = z
      .object({
        alt_phone: altPhoneSchema,
        code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const { alt_phone: alt, code } = parsed.data;

    const result = await consumeOtp(alt, "whatsapp_verify", code);
    if (!result.ok) {
      res.status(result.status).json({ message: result.message, code: result.code });
      return;
    }

    const saved = await setWhatsappAltPhone(phone, alt);
    if (!saved) {
      res.status(502).json({ message: "Could not save that. Please try again.", code: "SAVE_FAILED" });
      return;
    }
    res.json({ alt_phone: alt });
  });

  routes.delete("/api/whatsapp/alt", async (req: Request, res: Response) => {
    const phone = await ownPhone(req);
    if (!phone) {
      res.status(401).json({ message: "Sign in first.", code: "NOT_SIGNED_IN" });
      return;
    }
    const cleared = await clearWhatsappAltPhone(phone);
    if (!cleared) {
      res.status(502).json({ message: "Could not remove it. Please try again.", code: "SAVE_FAILED" });
      return;
    }
    res.json({ alt_phone: null });
  });
}
