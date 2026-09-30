import crypto from "crypto";
import { sendOtpBySms } from "./sms.js";

export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;
/**
 * Per-phone request ceiling, per rolling hour.
 *
 * Higher in development because a single manual test of the login flow costs a
 * request and five is spent in one sitting. This is an anti-abuse control on an
 * endpoint that sends SMS at our expense, so production stays at 5 — never
 * raise the non-dev value without a reason to.
 */
export const OTP_MAX_REQUESTS_PER_HOUR =
  process.env.NODE_ENV === "development" ? 20 : 5;
export const OTP_VERIFICATION_WINDOW_MINUTES = 10;

/**
 * TEMPORARY — the fixed login code, for testing.
 *
 *   OTP_FIXED_CODE=121212
 *
 * Every code issued becomes this one. Nothing else changes: it is hashed into
 * `otp_codes` like any other code, still expires in OTP_TTL_MINUTES, still
 * locks out after OTP_MAX_ATTEMPTS wrong guesses, and still gets sent by SMS.
 * Only the randomness is gone.
 *
 * WHY THIS RATHER THAN `OTP_DEV_BYPASS`: that flag accepts *any* code and skips
 * the comparison entirely, so nothing about verification is exercised while it
 * is on. This one leaves the whole check in place and makes only the value
 * predictable — a strictly smaller hole, and it lets a tester who is not on the
 * WhatsApp account log in without one.
 *
 * Deliberately NOT gated on NODE_ENV, for the same reason PAYMENTS_TEST_MODE is
 * not: the client tests on a deployed staging build where NODE_ENV is
 * production. The trade is that the variable itself is the only thing standing
 * between this and real accounts, so it announces itself at boot.
 *
 * **ANYONE WHO KNOWS A PHONE NUMBER CAN LOG IN AS ITS OWNER WHILE THIS IS SET.
 * It must never be set on an environment holding real customers.**
 *
 * Ignored unless it is exactly OTP_LENGTH digits — a typo'd value must not
 * silently become the code for every account.
 */
export function fixedOtpCode(): string | null {
  const raw = process.env.OTP_FIXED_CODE?.trim();
  if (!raw) return null;
  if (raw.length !== OTP_LENGTH || !/^[0-9]+$/.test(raw)) {
    console.error(
      `[otp] OTP_FIXED_CODE is not ${OTP_LENGTH} digits — ignoring it and issuing random codes.`
    );
    return null;
  }
  return raw;
}

/** Called once at boot. Silent when the flag is unset. */
export function warnIfFixedOtpEnabled(): void {
  const code = fixedOtpCode();
  if (!code) return;

  const where =
    process.env.NODE_ENV === "production" ? "a PRODUCTION build" : "development";

  console.warn(
    [
      "",
      "  ############################################################",
      `  ##  OTP_FIXED_CODE=${code}`,
      "  ##  Every login code is this one. Anyone who knows a phone",
      "  ##  number can log in as its owner.",
      `  ##  Running in ${where}.`,
      "  ##  Unset this before this environment has real customers.",
      "  ############################################################",
      "",
    ].join("\n")
  );
}

export function generateOtp(): string {
  const fixed = fixedOtpCode();
  if (fixed) return fixed;

  const n = crypto.randomInt(0, 10 ** OTP_LENGTH);
  return String(n).padStart(OTP_LENGTH, "0");
}

export function hashOtp(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Deliver a login code by SMS.
 *
 * SMS is the only channel for this code. WhatsApp still carries order,
 * payment, and rider messages; it is not asked to carry a login code.
 *
 * The code is logged in DEVELOPMENT ONLY. Production logs must not hold a
 * plaintext login code.
 *
 * With OTP_FIXED_CODE set no SMS is sent at all: the code is already known,
 * so texting it only spends MSG91 credit and lands on the tester's phone.
 * Unset the variable and every login goes back to SMS.
 *
 * @returns whether MSG91 accepted the send (always true under OTP_FIXED_CODE).
 *          Not whether the handset has it — DLT can still drop a message
 *          MSG91 has accepted.
 */
export async function deliverOtp(phone: string, code: string): Promise<boolean> {
  if (process.env.NODE_ENV === "development") {
    console.log(`[otp] OTP for ${phone}: ${code}`);
  }

  if (fixedOtpCode() !== null) return true;

  const result = await sendOtpBySms(phone, code);
  return result.ok;
}
