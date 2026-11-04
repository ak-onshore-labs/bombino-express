/**
 * The Indian WhatsApp number of a customer who signs in from abroad.
 *
 * THE RULE (Aditya, 3 Nov 2026):
 *   - WhatsApp updates go to the sign-in number by default, wherever it is.
 *   - When that number turns out not to be on WhatsApp, the app asks for an
 *     Indian number that is, proves it with a code sent on WhatsApp, and
 *     updates go there from then on.
 *   - Adding one while the sign-in number IS on WhatsApp is allowed; it is a
 *     standby, used only if the sign-in number later stops answering.
 *
 * "Not on WhatsApp" is the same signal the profile's "Verify WhatsApp" prompt
 * reads (whatsappDb §Reachability): Meta's failed receipt on the login code.
 *
 * Every read here is defensive. Until migrations/create_whatsapp_alt_numbers.sql
 * is applied the table does not exist, and every read answers "no alternate"
 * so messages carry on going where they always went.
 */

import { dbClient, logDbError, type DbError } from "./db/client.js";
import { toWaMsisdn } from "./whatsapp.js";
import { getWhatsappReachability } from "./whatsappDb.js";
import { WA_TEMPLATE } from "./whatsappTemplates.js";
import { isInternationalPhone } from "../shared/contact.js";
import { isTestOtpNumber } from "./otp.js";

const TABLE = "whatsapp_alt_numbers";
const getClient = () => dbClient("whatsappAlt");

let missingTableLogged = false;

function logError(operation: string, error: DbError): void {
  // Postgres "undefined table" / PostgREST "not in schema cache": the
  // migration has not been applied yet. Say so once, not on every send.
  if (error?.code === "42P01" || error?.code === "PGRST205") {
    if (!missingTableLogged) {
      missingTableLogged = true;
      console.warn(
        "[whatsappAlt] whatsapp_alt_numbers does not exist yet — run " +
          "migrations/create_whatsapp_alt_numbers.sql. Until then no alternate numbers."
      );
    }
    return;
  }
  logDbError("whatsappAlt", operation, error);
}

/** The verified Indian alternate for this sign-in number, or null. */
export async function getWhatsappAltPhone(phone: string | null | undefined): Promise<string | null> {
  const key = (phone ?? "").trim();
  if (!key) return null;
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client.from(TABLE).select("alt_phone").eq("phone", key).maybeSingle();
  if (error) {
    logError("get", error);
    return null;
  }
  const alt = typeof data?.alt_phone === "string" ? data.alt_phone : null;
  return alt || null;
}

/** Save a verified alternate. Callers have already proved it with a code. */
export async function setWhatsappAltPhone(phone: string, altPhone: string): Promise<boolean> {
  const client = getClient();
  if (!client) return false;
  const now = new Date().toISOString();
  const { error } = await client
    .from(TABLE)
    .upsert({ phone, alt_phone: altPhone, verified_at: now, updated_at: now }, { onConflict: "phone" });
  if (error) {
    logError("set", error);
    return false;
  }
  return true;
}

export async function clearWhatsappAltPhone(phone: string): Promise<boolean> {
  const client = getClient();
  if (!client) return false;
  const { error } = await client.from(TABLE).delete().eq("phone", phone);
  if (error) {
    logError("clear", error);
    return false;
  }
  return true;
}

export type WhatsappReach = "on_whatsapp" | "not_on_whatsapp" | "unknown";

/** Whether the sign-in number is on WhatsApp, as far as Meta's receipts say. */
export async function whatsappReachOf(phone: string | null | undefined): Promise<WhatsappReach> {
  // A test account from abroad is never sent anything, so Meta never sends a
  // receipt. It counts as not on WhatsApp, so it always walks the
  // Indian-alternate flow (otp.ts TEST_OTP_INTL_NUMBERS).
  if (phone && isInternationalPhone(phone) && isTestOtpNumber(phone)) return "not_on_whatsapp";
  const msisdn = toWaMsisdn(phone);
  if (!msisdn) return "unknown";
  return getWhatsappReachability(msisdn, WA_TEMPLATE.loginOtp);
}

/**
 * Pure: which number a WhatsApp update goes to. Exported for tests.
 * The sign-in number, unless it is known not to be on WhatsApp and a verified
 * alternate exists.
 */
export function chooseWhatsappTarget(
  phone: string | null,
  altPhone: string | null,
  reach: WhatsappReach
): string | null {
  if (!altPhone) return phone;
  if (!phone) return altPhone;
  return reach === "not_on_whatsapp" ? altPhone : phone;
}

/**
 * The number a customer's WhatsApp updates go to. See THE RULE above.
 *
 * Never throws; on any failure it answers the sign-in number, which is what
 * every send did before this file existed.
 */
export async function whatsappTargetFor(phone: string | null | undefined): Promise<string | null> {
  const own = (phone ?? "").trim() || null;
  if (!own) return null;
  // Only customers from abroad are offered an alternate, so an Indian number
  // never costs the extra lookup.
  if (!isInternationalPhone(own)) return own;
  try {
    const alt = await getWhatsappAltPhone(own);
    if (!alt) return own;
    return chooseWhatsappTarget(own, alt, await whatsappReachOf(own));
  } catch (error) {
    console.error("[whatsappAlt] target lookup threw (using the sign-in number)", {
      error: error instanceof Error ? error.message : String(error),
    });
    return own;
  }
}
