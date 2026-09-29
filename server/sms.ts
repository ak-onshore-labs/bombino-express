/**
 * SMS — the login code, sent through MSG91's Send OTP API.
 *
 * The app owns the code (see server/otp.ts). MSG91 is transport only: this
 * posts OUR code as the `otp` query parameter on a Send OTP template. We do
 * not call MSG91's verify or resend endpoints. The wording lives on the
 * template, not in this file.
 *
 * Unset credentials are a normal state until the keys exist. Nothing here
 * throws. NEVER LOG THE CODE, and never log the request URL — it carries the
 * code.
 */

const OTP_URL = "https://control.msg91.com/api/v5/otp";
/** Matches OTP_LENGTH in server/otp.ts. Not imported: otp.ts already imports this file. */
const OTP_LENGTH = "6";
/** Matches OTP_TTL_MINUTES in server/otp.ts. Same reason. */
const DEFAULT_OTP_EXPIRY_MIN = 5;
const TIMEOUT_MS = 8_000;

export type SmsOutcome =
  | { ok: true }
  | { ok: false; reason: "unconfigured" | "no_number" | "failed" };

interface Msg91Config {
  authkey: string;
  templateId: string;
}

function msg91Config(): Msg91Config | null {
  const authkey = process.env.MSG91_AUTHKEY?.trim();
  const templateId = process.env.MSG91_TEMPLATE_ID?.trim();
  if (!authkey || !templateId) return null;
  return { authkey, templateId };
}

/** Positive integer minutes, or the app's OTP lifetime when the env is unset or junk. */
function otpExpiryMin(): string {
  const raw = process.env.MSG91_OTP_EXPIRY_MIN?.trim();
  if (!raw) return String(DEFAULT_OTP_EXPIRY_MIN);
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return String(DEFAULT_OTP_EXPIRY_MIN);
  return String(n);
}

/**
 * A stored phone number as 10 Indian digits.
 *
 * MSG91 wants `91` in front of these; the caller adds it. Kept separate from
 * the WhatsApp helper — the two channels have disagreed about the country
 * prefix, and one shared function is how a working number becomes undeliverable.
 */
export function toSmsNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return digits;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits.slice(2);
  if (/^0[6-9]\d{9}$/.test(digits)) return digits.slice(1);
  return null;
}

let missingConfigLogged = false;

/**
 * Send one OTP by SMS.
 *
 * Success is MSG91's JSON `type === "success"`. A 200 with `type: "error"`,
 * a non-2xx, a timeout, or a body that is not JSON are all failures. The
 * code is a query parameter and must not appear in a log line.
 */
export async function sendOtpBySms(phone: string, code: string): Promise<SmsOutcome> {
  const to = toSmsNumber(phone);
  if (!to) {
    console.warn("[sms] no usable number");
    return { ok: false, reason: "no_number" };
  }

  const config = msg91Config();
  if (!config) {
    if (!missingConfigLogged) {
      missingConfigLogged = true;
      console.warn(
        "[sms] MSG91_AUTHKEY or MSG91_TEMPLATE_ID is not set — login codes will not be sent."
      );
    }
    console.error("[sms] (unconfigured) OTP not delivered", { phone });
    return { ok: false, reason: "unconfigured" };
  }

  const query = new URLSearchParams({
    template_id: config.templateId,
    mobile: `91${to}`,
    otp: code,
    otp_length: OTP_LENGTH,
    otp_expiry: otpExpiryMin(),
  });

  try {
    const response = await fetch(`${OTP_URL}?${query.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: config.authkey,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await response.text();
    let parsed: { type?: unknown; message?: unknown };
    try {
      parsed = JSON.parse(text) as { type?: unknown; message?: unknown };
    } catch {
      console.error("[sms] MSG91 response was not JSON", { phone, status: response.status });
      return { ok: false, reason: "failed" };
    }

    if (!response.ok || parsed.type !== "success") {
      const detail = typeof parsed.message === "string" ? parsed.message.slice(0, 200) : null;
      console.error("[sms] MSG91 refused the OTP", {
        phone,
        status: response.status,
        type: typeof parsed.type === "string" ? parsed.type : null,
        detail,
      });
      return { ok: false, reason: "failed" };
    }

    return { ok: true };
  } catch (error) {
    console.error("[sms] send failed", {
      phone,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "failed" };
  }
}
