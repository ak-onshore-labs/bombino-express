import crypto from "crypto";
import { sendOtpBySms } from "./sms.js";
import { sendTemplate, toWaMsisdn } from "./whatsapp.js";
import { getWhatsappReachability } from "./whatsappDb.js";
import { loginOtpMessage } from "./whatsappTemplates.js";

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

export function isTestOtpNumber(phone: string, numbers: ReadonlySet<string> = TEST_OTP_NUMBERS): boolean {
  const ten = lastTen(phone);
  return ten !== null && numbers.has(ten);
}

/** Called once at boot. Silent when neither flag is set. */
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

/** A new login code. Pass the phone so a listed test account gets 121212. */
export function generateOtp(phone?: string): string {
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

  // A test account: the code is known, and the number cannot receive it.
  if (isTestOtpNumber(phone)) return true;

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
