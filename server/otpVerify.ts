/**
 * Single implementation of "is this the code we sent?".
 *
 * Lives outside routes.ts because two endpoints consume a code now —
 * /api/auth/otp/verify (signup) and /api/auth/phone/continue (the unified
 * entry) — and a second copy of this logic is exactly where a check gets
 * dropped. Callers map the returned status/message/code straight onto the response;
 * the code is the catalogued one (shared/errorCatalog.ts).
 */
import type { ErrorCode } from "../shared/errorCatalog.js";
import { hashOtp, OTP_MAX_ATTEMPTS } from "./otp.js";
import {
  getLatestOtpForVerify,
  incrementAttempts,
  markConsumed,
  type OtpPurpose,
} from "./otpDb.js";

export type OtpConsumeResult =
  | { ok: true }
  | { ok: false; status: number; message: string; code: ErrorCode };

/**
 * Dev-only escape hatch for when no delivery channel is configured
 * (otp.ts §deliverOtp).
 *
 * Two conditions, not one: NODE_ENV alone is a single misconfigured deploy
 * variable away from accepting any code in production, and this gate is the
 * whole of phone authentication now that phone is the primary credential.
 * The opt-in must be explicit and must never be set outside local dev.
 */
function devBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" && process.env.OTP_DEV_BYPASS === "1"
  );
}

/**
 * Check a code, and optionally spend it.
 *
 * `consume: false` leaves the row usable, for the one case where proving
 * ownership and acting on it are two different decisions: a guest booking
 * whose number turns out to belong to an account. That answer can only be
 * given to somebody who has already presented the right code, and the code
 * they presented is a perfectly good one for signing in — spending it would
 * cost them a second SMS to be told to use the door they are standing at.
 *
 * A wrong code still counts against the attempt ceiling either way; only the
 * success is withheld.
 */
export async function verifyOtp(
  phone: string,
  purpose: OtpPurpose,
  code: string,
  options?: { consume?: boolean }
): Promise<OtpConsumeResult> {
  const row = await getLatestOtpForVerify(phone, purpose);
  if (!row) {
    return {
      ok: false,
      status: 400,
      message: "No pending OTP for this number. Request a new one.",
      code: "OTP_NOT_REQUESTED",
    };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return {
      ok: false,
      status: 400,
      message: "This OTP has expired. Request a new one.",
      code: "OTP_EXPIRED",
    };
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    return {
      ok: false,
      status: 429,
      message: "Too many incorrect attempts. Request a new OTP.",
      code: "OTP_TOO_MANY_ATTEMPTS",
    };
  }

  if (!devBypassEnabled() && hashOtp(code) !== row.code_hash) {
    // Without this the ceiling checked above is unreachable — `attempts` stayed
    // at 0 for the life of every row, so the lockout never fired.
    await incrementAttempts(row.id, row.attempts);
    return { ok: false, status: 400, message: "Incorrect code", code: "OTP_WRONG" };
  }

  if (options?.consume !== false) {
    await markConsumed(row.id);
  }
  return { ok: true };
}

/** The common case: check the code and spend it. */
export async function consumeOtp(
  phone: string,
  purpose: OtpPurpose,
  code: string
): Promise<OtpConsumeResult> {
  return verifyOtp(phone, purpose, code, { consume: true });
}
