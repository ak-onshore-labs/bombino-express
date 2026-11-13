import crypto from "crypto";
import { sendOtpBySms } from "./sms.js";
import { sendTemplate, toWaMsisdn } from "./whatsapp.js";
import { getWhatsappReachability } from "./whatsappDb.js";
import { loginOtpMessage } from "./whatsappTemplates.js";
import { isInternationalPhone } from "../shared/contact.js";

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
 * TEMPORARY — the fixed login code, for local testing only.
 *
 *   OTP_FIXED_CODE=121212
 *
 * Every code issued becomes this one. Nothing else changes: it is hashed into
 * `otp_codes` like any other code, still expires in OTP_TTL_MINUTES, still
 * locks out after OTP_MAX_ATTEMPTS wrong guesses, and still gets sent by SMS.
 * Only the randomness is gone.
 *
 * Development only. In production builds this always returns null — use
 * REVIEW_OTP_PHONE + REVIEW_OTP_CODE for a single App Store reviewer number.
 *
 * Ignored unless it is exactly OTP_LENGTH digits — a typo'd value must not
 * silently become the code for every account.
 */
export function fixedOtpCode(): string | null {
  if (process.env.NODE_ENV === "production") return null;
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

/**
 * App Store reviewer login: one configured phone accepts one configured code.
 *
 *   REVIEW_OTP_PHONE=98xxxxxxxx
 *   REVIEW_OTP_CODE=………
 *
 * Both must be set. The code must be OTP_LENGTH digits. Nothing is sent to the
 * number. Checked before every other fixed-code path.
 */
export function reviewOtp(): { phone: string; code: string } | null {
  const phone = process.env.REVIEW_OTP_PHONE?.trim() ?? "";
  const code = process.env.REVIEW_OTP_CODE?.trim() ?? "";
  if (!phone || !code) return null;
  if (code.length !== OTP_LENGTH || !/^[0-9]+$/.test(code)) {
    console.error(
      `[otp] REVIEW_OTP_CODE is not ${OTP_LENGTH} digits — ignoring reviewer login.`
    );
    return null;
  }
  return { phone, code };
}

export function isReviewPhone(phone: string): boolean {
  const review = reviewOtp();
  if (!review) return false;
  // Same matching rules as isTestOtpNumber: exact E.164 abroad, last ten digits in India.
  const trimmed = phone.trim();
  if (isInternationalPhone(trimmed) || (trimmed.startsWith("+") && !trimmed.startsWith("+91"))) {
    const want = `+${review.phone.replace(/\D/g, "")}`;
    const got = `+${trimmed.replace(/\D/g, "")}`;
    return want === got;
  }
  const ten = lastTen(phone);
  const reviewTen = lastTen(review.phone);
  return ten !== null && reviewTen !== null && ten === reviewTen;
}

/**
 * Test accounts that always take 121212, while every other number gets a real
 * random code. Built in, not a setting. The list is the "Test Accounts" tab of
 * the "Bombino Ops Console – Team Access" sheet; keep the two in step.
 *
 * Exact numbers only, never a range. Nothing is sent to them by SMS or
 * WhatsApp: they are dummies that cannot receive it, and every send costs
 * MSG91 credit.
 *
 * KNOWN TRADE-OFF, Aditya's call (6 Oct 2026): the code is public, so anyone
 * who knows one of these numbers can sign in as it, the super admin and admin
 * included. Deactivate an account in Users rather than keep it here once
 * nobody is testing with it.
 */
export const TEST_OTP_CODE = "121212";

export const TEST_OTP_NUMBERS: ReadonlySet<string> = new Set([
  // Ops console
  "9000000011", // Test Super Admin
  "9000000010", // Test Admin
  "9000000020", // Test Branch Manager (Mumbai), added 8 Oct 2026
  "9000000099", // Real View Super Admin: sees what real staff see (REAL_VIEW_PHONES), added 14 Oct 2026
  // Customers
  "9000000090", // Test Customer (seed)
  "9000000016", // E2E Test Logistics (company)
  "9000000095", // E2E Customer Two
  // Agents
  "9000000014", // Ravi Deshmukh
  "9000000012", // Imran Shaikh
  "9000000013", // Sunita Pawar
  "9000000001", // Test Agent One
  "9000000031", // Demo User
  "9000000055", // Demo Agent
  "9000000050", // added 13 Oct 2026
  "9898989898", // Pickup Agent
  "9797979797", // Ganesh
  // Guest booking (no account)
  "9000000096",
]);

/** The last ten digits, or null when there are fewer. */
function lastTen(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/**
 * Test accounts from abroad, in their stored form (E.164). Matched exactly,
 * never by last ten digits: "+12025550123" must not make the Indian
 * "2025550123" (or anything else) a test number.
 *
 * +1 202-555-0123 is in the US 555-0100..0199 range reserved for fiction, so
 * it can never be a real person's. Added 4 Nov 2026 to test sign-in from
 * abroad and the Indian WhatsApp alternate: it reads as "not on WhatsApp"
 * (server/whatsappAlt.ts), so the app always asks it for an Indian number.
 */
export const TEST_OTP_INTL_NUMBERS: ReadonlySet<string> = new Set([
  "+12025550123", // Test Customer Abroad (US)
]);

export function isTestOtpNumber(phone: string, numbers: ReadonlySet<string> = TEST_OTP_NUMBERS): boolean {
  // A foreign number is a test account only by exact match. Its last ten
  // digits must never happen to match an Indian one and get the public code.
  const trimmed = phone.trim();
  if (isInternationalPhone(trimmed) || (trimmed.startsWith("+") && !trimmed.startsWith("+91"))) {
    return TEST_OTP_INTL_NUMBERS.has(`+${trimmed.replace(/\D/g, "")}`);
  }
  const ten = lastTen(phone);
  return ten !== null && numbers.has(ten);
}

/** Called once at boot. Silent when the flag is off or production. */
export function warnIfFixedOtpEnabled(): void {
  const code = fixedOtpCode();
  if (!code) return;

  console.warn(
    [
      "",
      "  ############################################################",
      `  ##  OTP_FIXED_CODE=${code}`,
      "  ##  Every login code is this one (development only).",
      "  ##  Anyone who knows a phone number can log in as its owner.",
      "  ############################################################",
      "",
    ].join("\n")
  );
}

/** Called once at boot. Prints the phone, never the code. */
export function warnIfReviewOtpEnabled(): void {
  const review = reviewOtp();
  if (!review) return;

  console.warn(
    [
      "",
      "  ############################################################",
      `  ##  REVIEW_OTP_PHONE=${review.phone}`,
      "  ##  That one number accepts the configured reviewer code.",
      "  ##  Nothing is sent to it by SMS or WhatsApp.",
      "  ############################################################",
      "",
    ].join("\n")
  );
}

/** A new login code. Pass the phone so a listed test / reviewer account gets its fixed value. */
export function generateOtp(phone?: string): string {
  if (phone) {
    const review = reviewOtp();
    if (review && isReviewPhone(phone)) return review.code;
  }
  const fixed = fixedOtpCode();
  if (fixed) return fixed;
  if (phone && isTestOtpNumber(phone)) return TEST_OTP_CODE;

  const n = crypto.randomInt(0, 10 ** OTP_LENGTH);
  return String(n).padStart(OTP_LENGTH, "0");
}

export function hashOtp(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * The WhatsApp dedupe key for one issued code.
 *
 * Keyed on the `otp_codes` row id, which is new on every request. NOT on the
 * code: under OTP_FIXED_CODE every code is the same, so a code-derived key made
 * every send after the first a "duplicate" and nothing went out. The code
 * never appears in the key either way — `otp_codes` stores only its hash.
 */
export function otpDedupeKey(otpId: string, purpose = "otp"): string {
  return `${purpose}:${otpId}`;
}

/**
 * Deliver a login code — on WhatsApp and by SMS, at the same time.
 *
 * Both, not one-then-the-other. Meta ACCEPTS a message to a number with no
 * WhatsApp and only reports it `failed` on the status webhook afterwards, so a
 * WhatsApp-first design makes every non-WhatsApp customer wait out a grace
 * period for their SMS. Sending both costs a message and costs nobody time.
 *
 * The WhatsApp send doubles as the silent "is this number on WhatsApp?" check:
 * its receipt is what `getWhatsappReachability` reads. It therefore skips the
 * reachability gate — a number marked unreachable must keep being re-tried on
 * login, or it could never be marked reachable again.
 *
 * SMS carries the login code and nothing else.
 *
 * With OTP_FIXED_CODE set, both channels still send the fixed code, so testers
 * see the real SMS and WhatsApp deliveries. Neither result gates login then:
 * the code is already known, so a failed send must not block anyone.
 *
 * The code is logged in DEVELOPMENT ONLY. Production logs must not hold a
 * plaintext login code.
 *
 * @returns whether either channel accepted the send (always true under
 *          OTP_FIXED_CODE). Not whether the handset has it.
 */
export async function deliverOtp(
  phone: string,
  code: string,
  otpId: string
): Promise<boolean> {
  if (process.env.NODE_ENV === "development") {
    console.log(`[otp] OTP for ${phone}: ${code}`);
  }

  // A test or reviewer account: the code is known, and nothing is sent.
  if (isTestOtpNumber(phone) || isReviewPhone(phone)) return true;

  const fixed = fixedOtpCode() !== null;
  const message = loginOtpMessage(code);

  const [whatsapp, sms] = await Promise.all([
    sendTemplate({
      to: phone,
      template: message.template,
      variables: message.variables,
      otpButtonCode: message.otpButtonCode,
      dedupeKey: otpDedupeKey(otpId),
      // The login code is a credential. Store a placeholder, send the real thing.
      redactVariables: true,
      skipReachabilityCheck: true,
    }),
    sendOtpBySms(phone, code),
  ]);

  if (fixed) return true;
  if (sms?.ok) return true;
  if (!whatsapp.ok) return false;

  // SMS refused, WhatsApp accepted. Meta accepts sends to numbers with no
  // WhatsApp, so "accepted" only counts if this number is not already known to
  // be one of those — otherwise the customer is told "OTP sent" and gets nothing.
  const msisdn = toWaMsisdn(phone);
  if (!msisdn) return false;
  return (await getWhatsappReachability(msisdn, message.template)) !== "not_on_whatsapp";
}
