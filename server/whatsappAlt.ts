/**
 * A customer's second WhatsApp number, and which number their updates go to.
 *
 * THE RULE (Aditya, 3 Nov 2026; widened 4 Nov 2026):
 *   - Any customer, whatever country their sign-in number is from, can add a
 *     second WhatsApp number, from any country. It is proved with a code sent
 *     to it on WhatsApp before it is saved.
 *   - The customer chooses which of the two gets updates (`use_for_updates`).
 *     Adding one picks it; they can switch back.
 *   - When the sign-in number is known not to be on WhatsApp, updates go to
 *     the second number whatever the choice says: the other way reaches nobody.
 *   - No second number: updates go to the sign-in number, as always.
 *
 * Signup and sign-in ask for one when the sign-in number turns out not to be
 * on WhatsApp. "Not on WhatsApp" is the same signal the profile's "Verify
 * WhatsApp" prompt reads (whatsappDb §Reachability): Meta's failed receipt on
 * the login code.
 *
 * Every read here is defensive. Until migrations/create_whatsapp_alt_numbers.sql
 * is applied the table does not exist, and every read answers "no second
 * number" so messages carry on going where they always went. Until
 * whatsapp_alt_numbers_any_number.sql is applied there is no use_for_updates
 * column (read as true) and only Indian numbers can be saved.
 */

import { dbClient, logDbError, type DbError } from "./db/client.js";
import { toWaMsisdn } from "./whatsapp.js";
import { getWhatsappReachability } from "./whatsappDb.js";
import { WA_TEMPLATE } from "./whatsappTemplates.js";
import { isTestOtpNumber } from "./otp.js";

const TABLE = "whatsapp_alt_numbers";
const getClient = () => dbClient("whatsappAlt");

let missingTableLogged = false;
let missingColumnLogged = false;

/** Postgres "undefined column" / PostgREST "column not in schema cache". */
function isMissingColumn(error: DbError): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

/** Postgres check violation: alt_phone from abroad before the widening migration. */
function isCheckViolation(error: DbError): boolean {
  return error?.code === "23514";
}

function noteMissingColumn(): void {
  if (missingColumnLogged) return;
  missingColumnLogged = true;
  console.warn(
    "[whatsappAlt] whatsapp_alt_numbers.use_for_updates does not exist yet — run " +
      "migrations/whatsapp_alt_numbers_any_number.sql. Until then a second number always gets updates."
  );
}

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

export interface WhatsappAlt {
  /** The second number, stored form: "9876543210" or "+971501234567". */
  altPhone: string;
  /** Whether updates go to it (true) or to the sign-in number (false). */
  useForUpdates: boolean;
}

/** The verified second number for this sign-in number, or null. */
export async function getWhatsappAlt(phone: string | null | undefined): Promise<WhatsappAlt | null> {
  const key = (phone ?? "").trim();
  if (!key) return null;
  const client = getClient();
  if (!client) return null;

  let { data, error } = await client
    .from(TABLE)
    .select("alt_phone, use_for_updates")
    .eq("phone", key)
    .maybeSingle();
  if (error && isMissingColumn(error)) {
    noteMissingColumn();
    ({ data, error } = await client.from(TABLE).select("alt_phone").eq("phone", key).maybeSingle());
  }
  if (error) {
    logError("get", error);
    return null;
  }
  const row = data as { alt_phone?: unknown; use_for_updates?: unknown } | null;
  const alt = typeof row?.alt_phone === "string" ? row.alt_phone : "";
  if (!alt) return null;
  return { altPhone: alt, useForUpdates: row?.use_for_updates !== false };
}

/** Just the number, for callers that only need that. */
export async function getWhatsappAltPhone(phone: string | null | undefined): Promise<string | null> {
  return (await getWhatsappAlt(phone))?.altPhone ?? null;
}

export type SaveAltResult = "saved" | "failed" | "country_not_supported_yet";

/**
 * Save a verified second number. Callers have already proved it with a code.
 * Saving one chooses it for updates: that is why it was added.
 */
export async function setWhatsappAltPhone(phone: string, altPhone: string): Promise<SaveAltResult> {
  const client = getClient();
  if (!client) return "failed";
  const now = new Date().toISOString();
  const row = { phone, alt_phone: altPhone, verified_at: now, updated_at: now };

  let { error } = await client.from(TABLE).upsert({ ...row, use_for_updates: true }, { onConflict: "phone" });
  if (error && isMissingColumn(error)) {
    noteMissingColumn();
    ({ error } = await client.from(TABLE).upsert(row, { onConflict: "phone" }));
  }
  if (error && isCheckViolation(error)) return "country_not_supported_yet";
  if (error) {
    logError("set", error);
    return "failed";
  }
  return "saved";
}

/** Choose which number gets updates. False when there is no second number to choose. */
export async function setWhatsappAltUse(phone: string, useForUpdates: boolean): Promise<boolean> {
  const client = getClient();
  if (!client) return false;
  const { data, error } = await client
    .from(TABLE)
    .update({ use_for_updates: useForUpdates, updated_at: new Date().toISOString() })
    .eq("phone", phone)
    .select("phone");
  if (error) {
    if (isMissingColumn(error)) noteMissingColumn();
    else logError("use", error);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
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
  // A test number from abroad is never sent anything, so Meta never sends a
  // receipt. It counts as not on WhatsApp, so it always walks the
  // second-number flow (otp.ts TEST_OTP_INTL_NUMBERS). Indian test numbers
  // stay "unknown", as they always were.
  if (phone && phone.trim().startsWith("+") && isTestOtpNumber(phone)) return "not_on_whatsapp";
  const msisdn = toWaMsisdn(phone);
  if (!msisdn) return "unknown";
  return getWhatsappReachability(msisdn, WA_TEMPLATE.loginOtp);
}

/**
 * Pure: which number a WhatsApp update goes to. Exported for tests.
 * See THE RULE above.
 */
export function chooseWhatsappTarget(
  phone: string | null,
  alt: WhatsappAlt | null,
  reach: WhatsappReach
): string | null {
  if (!alt) return phone;
  if (!phone) return alt.altPhone;
  if (alt.useForUpdates || reach === "not_on_whatsapp") return alt.altPhone;
  return phone;
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
  try {
    const alt = await getWhatsappAlt(own);
    if (!alt) return own;
    // The receipt lookup only matters when the customer chose their own number.
    const reach = alt.useForUpdates ? "unknown" : await whatsappReachOf(own);
    return chooseWhatsappTarget(own, alt, reach);
  } catch (error) {
    console.error("[whatsappAlt] target lookup threw (using the sign-in number)", {
      error: error instanceof Error ? error.message : String(error),
    });
    return own;
  }
}
