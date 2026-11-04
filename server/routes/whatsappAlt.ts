/**
 * A customer's second WhatsApp number, and which number their updates go to.
 *
 *   GET    /api/whatsapp/alt           where updates go, and whether to ask for one
 *   POST   /api/whatsapp/alt/request   send a code on WhatsApp to the second number
 *   POST   /api/whatsapp/alt/confirm   type it back; the number is saved and chosen
 *   PATCH  /api/whatsapp/alt           choose which number gets updates
 *   DELETE /api/whatsapp/alt           stop using it
 *
 * For accounts, guests, and a signup in progress (right after its OTP, before
 * there is an account). The sign-in number is always the session's own, never
 * the body's: that would let a caller point someone else's updates at a
 * number of their choosing. The rule for which number a message goes to lives
 * in server/whatsappAlt.ts.
 *
 * The code goes out on WhatsApp ONLY, never by SMS. Typing it back is the
 * proof that the second number is on WhatsApp, which is the whole point of it.
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
import { isPhoneVerifiedHere } from "../signupRef.js";
import { sendTemplate } from "../whatsapp.js";
import { loginOtpMessage } from "../whatsappTemplates.js";
import {
  chooseWhatsappTarget,
  clearWhatsappAltPhone,
  getWhatsappAlt,
  setWhatsappAltPhone,
  setWhatsappAltUse,
  whatsappReachOf,
} from "../whatsappAlt.js";
import { ACCOUNT_PHONE_MESSAGE, isAccountPhone, isInternationalPhone } from "../../shared/contact.js";

/**
 * The session's own sign-in number: the account's, else the verified guest's,
 * else the number this browser just proved with an OTP (a signup before its
 * account exists; same ten-minute window the signup's documents use).
 */
async function ownPhone(req: Request): Promise<string | null> {
  const owner = ownerFrom(req, OWNER_PROFILES.nudges);
  if (owner?.kind === "guest") return owner.phone?.trim() || null;
  if (owner?.kind === "account") {
    const profile = await getItdUserProfileById(owner.userId);
    const phone = profile?.phone ? String(profile.phone).trim() : "";
    return phone || null;
  }
  const verified = req.session.verifiedPhone;
  if (verified && (await isPhoneVerifiedHere(req, verified))) return verified;
  return null;
}

/** Any number a customer could sign in with, stored form. */
const altPhoneSchema = z.string().trim().refine(isAccountPhone, ACCOUNT_PHONE_MESSAGE);

export function registerWhatsappAltRoutes(app: Express): void {
  const routes = asyncRoutes(app);

  routes.get("/api/whatsapp/alt", async (req: Request, res: Response) => {
    const phone = await ownPhone(req);
    if (!phone) {
      res.status(401).json({ message: "Sign in first.", code: "NOT_SIGNED_IN" });
      return;
    }
    const [whatsapp, alt] = await Promise.all([whatsappReachOf(phone), getWhatsappAlt(phone)]);
    const target = chooseWhatsappTarget(phone, alt, whatsapp);
    res.json({
      phone,
      international: isInternationalPhone(phone),
      whatsapp,
      alt_phone: alt?.altPhone ?? null,
      use_alt: alt?.useForUpdates ?? false,
      sends_to: alt && target === alt.altPhone ? "alt" : whatsapp === "not_on_whatsapp" ? "none" : "own",
      // Ask for one only when updates would otherwise reach nobody.
      needs_alt: whatsapp === "not_on_whatsapp" && !alt,
    });
  });

  routes.post("/api/whatsapp/alt/request", async (req: Request, res: Response) => {
    const phone = await ownPhone(req);
    if (!phone) {
      res.status(401).json({ message: "Sign in first.", code: "NOT_SIGNED_IN" });
      return;
    }
    const parsed = z.object({ alt_phone: altPhoneSchema }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const alt = parsed.data.alt_phone;
    // Both are in the stored form, so equal strings are the same number.
    if (alt === phone) {
      res.status(400).json({ message: "That is the number you signed in with. Enter a different one.", code: "SAME_NUMBER" });
      return;
    }

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
      // Its own purpose: a code that proves a number is on WhatsApp, and can
      // never be spent as a sign-in.
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
    if (saved === "country_not_supported_yet") {
      res.status(400).json({
        message: "Numbers from outside India can't be added just yet. Please use an Indian WhatsApp number.",
        code: "ALT_COUNTRY_NOT_SUPPORTED",
      });
      return;
    }
    if (saved !== "saved") {
      res.status(502).json({ message: "Could not save that. Please try again.", code: "SAVE_FAILED" });
      return;
    }
    res.json({ alt_phone: alt, use_alt: true });
  });

  routes.patch("/api/whatsapp/alt", async (req: Request, res: Response) => {
    const phone = await ownPhone(req);
    if (!phone) {
      res.status(401).json({ message: "Sign in first.", code: "NOT_SIGNED_IN" });
      return;
    }
    const parsed = z.object({ use_alt: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const updated = await setWhatsappAltUse(phone, parsed.data.use_alt);
    if (!updated) {
      res.status(502).json({ message: "Could not change that. Please try again.", code: "SAVE_FAILED" });
      return;
    }
    res.json({ use_alt: parsed.data.use_alt });
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
