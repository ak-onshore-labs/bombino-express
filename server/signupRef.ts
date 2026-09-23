/**
 * The staging handle an in-flight signup owns its rows under, and the proof
 * that authorises touching them.
 *
 * There is no account yet when documents and identity checks are staged, so
 * nothing can be authenticated against a session user. What authorises these
 * endpoints is a recent OTP on the number the account is being opened under —
 * the same proof `/api/auth/signup/*` asks for a moment later.
 *
 * Lifted verbatim out of the closure inside `registerRoutes`, where it could
 * not be imported or tested. Behaviour is unchanged.
 */

import crypto from "crypto";
import type { Request, Response } from "express";
import { z } from "zod";

import { INDIAN_MOBILE_MESSAGE, INDIAN_MOBILE_PATTERN } from "../shared/contact.js";
import { OTP_VERIFICATION_WINDOW_MINUTES } from "./otp.js";
import { hasRecentVerification } from "./otpDb.js";
import { deleteAllSignupDocuments } from "./accountDocsDb.js";
import { deleteIdentityVerificationsBySignupRef } from "./identityDb.js";
import { applicationToFix } from "./applicationFix.js";
import { isOpenApplicationRef } from "./accountApplicationsDb.js";

const phoneSchema = z.string().trim().regex(INDIAN_MOBILE_PATTERN, INDIAN_MOBILE_MESSAGE);

/** Mint the staging handle on first use; reuse it for the rest of the signup. */
/**
 * The handle this signup's staged rows are owned by, for this phone.
 *
 * Documents and identity verifications belong to a NUMBER, not to a browser.
 * The ref used to be minted once per session and never revisited, so
 * verifying a phone, proving an Aadhaar, then starting again with a
 * different number left the second signup holding the first one's verified
 * identity and uploaded files — and an account could open for one person on
 * another person's Aadhaar and PAN.
 *
 * So the ref is bound to the phone that proved it. When the phone changes
 * the old ref is abandoned, its rows are deleted, and a fresh one is minted.
 * Deletion is best-effort: an orphaned row is recoverable, but handing it to
 * the wrong person is not, and the new ref already guarantees the second
 * part regardless of whether the delete lands.
 *
 * Every staging and reading endpoint goes through here, so there is one
 * place where the binding can be got wrong.
 */
export async function signupRefForPhone(req: Request, phone: string): Promise<string> {
  if (req.session.signupPhone === phone && req.session.signupRef) {
    return req.session.signupRef;
  }

  const abandoned = req.session.signupPhone !== undefined ? req.session.signupRef : undefined;

  req.session.signupRef = crypto.randomUUID();
  req.session.signupPhone = phone;

  // An open application's files are not abandoned: the Bombino team is
  // working from them. Only the session lets go of the ref.
  if (abandoned && (await isOpenApplicationRef(abandoned))) {
    console.warn(`[signup] phone changed mid-signup — keeping ${abandoned}, it belongs to an open application`);
  } else if (abandoned) {
    console.warn(`[signup] phone changed mid-signup — discarding staged rows for ${abandoned}`);
    try {
      await Promise.all([
        deleteAllSignupDocuments(abandoned),
        deleteIdentityVerificationsBySignupRef(abandoned),
      ]);
    } catch (err) {
      console.error("[signup] failed to discard abandoned signup rows:", err);
    }
  }

  return req.session.signupRef;
}

/**
 * The ref for a read, without minting one.
 *
 * Returns null when this session has nothing staged for that phone, which
 * the readers answer as an empty list. A GET must never hand back rows
 * proved by a different number just because the same browser asked.
 */
export function signupRefForReading(req: Request, phone: string | undefined): string | null {
  if (!phone || req.session.signupPhone !== phone) return null;
  return req.session.signupRef ?? null;
}

/**
 * The signup endpoints have no session to authenticate against — the account
 * does not exist yet — so a recent OTP on the number is what authorises
 * them. That authorisation expires after OTP_VERIFICATION_WINDOW_MINUTES,
 * and filling in a documents screen takes longer than ten minutes often
 * enough that it is a normal thing to happen rather than an edge case.
 *
 * Both refusals carry `code: "phone_unverified"` so the form can act on it
 * without reading the prose. It sends the customer back to re-request a
 * code instead of leaving them on a screen where every button fails.
 */
export const PHONE_UNVERIFIED = "phone_unverified";

/**
 * Record, on THIS session, that the caller just proved `phone` with a code.
 * Called wherever a code is spent successfully.
 */
export function markPhoneVerified(req: Request, phone: string): void {
  req.session.verifiedPhone = phone;
  req.session.verifiedPhoneAt = Date.now();
}

/**
 * Did this browser prove `phone` within the verification window?
 *
 * A verification used to be looked up by number alone ("was this number
 * verified in the last ten minutes?"), so while a customer was signing up a
 * second browser could stage documents, open an account, or link an ITD login
 * on their number. The stamp lives in the server-side session, so only the
 * browser that typed the code carries it. The code row must also still read
 * as spent recently — belt and braces against a stamp outliving its code.
 */
export async function isPhoneVerifiedHere(req: Request, phone: string): Promise<boolean> {
  const at = req.session.verifiedPhoneAt;
  if (req.session.verifiedPhone !== phone || typeof at !== "number") return false;
  if (Date.now() - at > OTP_VERIFICATION_WINDOW_MINUTES * 60_000) return false;
  return hasRecentVerification(phone, "auth", OTP_VERIFICATION_WINDOW_MINUTES);
}

export async function assertPhoneVerified(
  phone: unknown,
  res: Response,
  req: Request,
  /**
   * Whether a live guest session may stand in for a fresh OTP.
   *
   * Only for routes a returning guest reaches from their profile rather than
   * mid-signup. `session.guestRef` can only have been minted by an OTP on
   * `session.guestPhone`, so it proves the same number — what it does not
   * carry is the ten-minute freshness, and for a customer filling in their
   * own profile over several visits that window is the wrong rule. Signup's
   * own calls leave this off and stay strict.
   */
  options: { allowSessionGuest?: boolean } = {}
): Promise<string | null> {
  const parsed = phoneSchema.safeParse(phone);
  if (!parsed.success) {
    res
      .status(400)
      .json({ message: "A verified phone number is required", code: PHONE_UNVERIFIED });
    return null;
  }

  if (options.allowSessionGuest && req.session.guestRef && req.session.guestPhone === parsed.data) {
    return parsed.data;
  }

  const verified = await isPhoneVerifiedHere(req, parsed.data);
  // A guest fixing the application the team sent back: the guest session is
  // the proof, and it points staging at that application's own files. See
  // server/applicationFix.ts.
  if (!verified && (await applicationToFix(req, parsed.data))) return parsed.data;
  if (!verified) {
    res.status(400).json({
      message: `Your phone verification has expired. Please request a new code.`,
      code: PHONE_UNVERIFIED,
    });
    return null;
  }
  return parsed.data;
}

