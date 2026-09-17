/**
 * The outbound WhatsApp log — `whatsapp_messages`.
 *
 * Every send claims its row here BEFORE the provider is called, and the claim
 * is what makes sending idempotent: `dedupe_key` carries a unique index, so a
 * second attempt at the same message loses the insert and never reaches
 * WhatsApp. Same fail-safe ordering as `recordCollectedPayment()` — a row with
 * no message is a puzzle, a message with no row is a duplicate nobody can see.
 *
 * Nothing in this file may throw. A missed WhatsApp must never fail the action
 * that triggered it (the contract from `appDb.insertNotification`), and the
 * only way to keep that promise is for every function here to return a value
 * on the failure path.
 */

import { supabase } from "./supabaseClient.js";
import { dbClient, logDbError, type DbError } from "./db/client.js";

/** Postgres unique_violation — the concurrent-writer signal, not an error. */
const UNIQUE_VIOLATION = "23505";

export type WhatsappStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "skipped";

const logSupabaseError = (operation: string, error: DbError): void =>
  logDbError("whatsappDb", operation, error);

const getSupabaseClient = () => dbClient("whatsappDb");

/**
 * Claim the right to send one message.
 *
 * `"duplicate"` is the success case for the caller's purposes: somebody has
 * already sent this exact message, so there is nothing to do and nothing went
 * wrong. Only `"error"` means the DB is unreachable — and even then the caller
 * sends nothing, because a send we cannot record is a send we cannot dedupe or
 * explain later.
 */
export async function claimMessage(input: {
  orderId: string | null;
  userId: string | null;
  toPhone: string;
  template: string;
  variables: string[];
  dedupeKey: string;
}): Promise<{ ok: true; id: string } | { ok: false; reason: "duplicate" | "error" }> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, reason: "error" };

  const { data, error } = await client
    .from("whatsapp_messages")
    .insert({
      order_id: input.orderId,
      user_id: input.userId,
      to_phone: input.toPhone,
      template: input.template,
      variables: input.variables,
      dedupe_key: input.dedupeKey,
      status: "queued",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: "duplicate" };
    logSupabaseError("claimMessage", error);
    return { ok: false, reason: "error" };
  }
  return { ok: true, id: data.id as string };
}

/**
 * The provider accepted it.
 *
 * `requestId` is what the send call returned — Tata's own reference, and NOT a
 * Meta `wamid`. It cannot be used to match delivery receipts; it exists so a
 * message that never arrives has a reference to quote at their support desk.
 * The `wamid` arrives later, on the receipt, and is written then.
 */
export async function markSent(id: string, requestId: string | null): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client
    .from("whatsapp_messages")
    .update({ request_id: requestId, status: "sent", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) logSupabaseError("markSent", error);
}

/**
 * The send did not happen.
 *
 * `skipped` and `failed` are deliberately different: skipped means we chose not
 * to send (no token configured, dry run, recipient opted out) and failed means
 * we tried and WhatsApp refused. Only the second is a problem, and an ops query
 * that cannot tell them apart will either cry wolf in development or hide a
 * real outage behind a wall of dry-run rows.
 */
export async function markNotSent(
  id: string,
  status: "failed" | "skipped",
  error: Record<string, unknown> | null
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const { error: updateError } = await client
    .from("whatsapp_messages")
    .update({ status, error, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) logSupabaseError("markNotSent", updateError);
}

/**
 * A delivery receipt from the webhook.
 *
 * Statuses arrive out of order — a `delivered` callback can land after `read`
 * on a slow connection — so a receipt never moves a message backwards. The
 * rank below is the only ordering that matters; anything at or below where the
 * row already is, is dropped.
 */
const STATUS_RANK: Record<WhatsappStatus, number> = {
  queued: 0,
  skipped: 1,
  failed: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

export async function applyDeliveryReceipt(input: {
  /**
   * Our own row id, echoed back by the provider in `custom_callback_data`.
   *
   * THE ONLY RELIABLE MATCH. The id returned when a message is sent is Tata's
   * request id, while receipts carry a Meta `wamid` — two different id spaces,
   * so nothing sent can be found by anything received. Round-tripping our own
   * id through `metaData.custom_callback_data` is what closes that gap, and it
   * is the mechanism the API provides for exactly this.
   */
  rowId: string | null;
  /** Meta's message id, from the receipt. Recorded, and a fallback match. */
  providerId: string | null;
  status: WhatsappStatus;
  error: Record<string, unknown> | null;
}): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  if (!input.rowId && !input.providerId) return;

  const lookup = client.from("whatsapp_messages").select("id, status, provider_id");
  const { data, error } = await (input.rowId
    ? lookup.eq("id", input.rowId)
    : lookup.eq("provider_id", input.providerId as string)
  ).maybeSingle();

  if (error) {
    logSupabaseError("applyDeliveryReceipt:read", error);
    return;
  }
  // A receipt for a message we never recorded. Happens if the token is shared
  // with another environment pointed at the same WABA — worth a log, not an
  // error, and certainly not a non-2xx back to the BSP.
  if (!data) {
    console.warn("[whatsappDb] delivery receipt for an unknown message", {
      row_id: input.rowId,
      provider_id: input.providerId,
      status: input.status,
    });
    return;
  }

  const current = (data.status as WhatsappStatus) ?? "queued";
  // `failed` always wins: a message that failed after being marked sent is the
  // one state ops must not lose to a late `sent` callback.
  const isRegression =
    input.status !== "failed" && STATUS_RANK[input.status] <= STATUS_RANK[current];
  if (isRegression) return;

  const { error: updateError } = await client
    .from("whatsapp_messages")
    .update({
      status: input.status,
      // First receipt is where the wamid becomes knowable. Kept so a support
      // ticket can quote the id Meta itself uses.
      ...(input.providerId && !data.provider_id ? { provider_id: input.providerId } : {}),
      ...(input.error ? { error: input.error } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.id);
  if (updateError) logSupabaseError("applyDeliveryReceipt:update", updateError);
}

/**
 * Where one message got to, by its dedupe key.
 *
 * Read by the OTP fallback a few seconds after sending: a number that is not on
 * WhatsApp is normally accepted by Meta and only reported `failed` on the status
 * webhook afterwards, so "did that arrive?" cannot be answered at send time.
 */
export async function getMessageStatusByDedupeKey(
  dedupeKey: string
): Promise<WhatsappStatus | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("whatsapp_messages")
    .select("status")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();

  if (error) {
    logSupabaseError("getMessageStatusByDedupeKey", error);
    return null;
  }
  return (data?.status as WhatsappStatus | undefined) ?? null;
}

// ── Recipients ────────────────────────────────────────────────────────────
//
// Who we may message, and on what number. Deliberately its own read rather
// than a reuse of `ordersDb.getUserContactsByIds`, because that one does not
// carry `metadata` and the opt-out flag lives there.

export type WhatsappRecipient = {
  id: string;
  full_name: string | null;
  phone: string | null;
  optedOut: boolean;
};

function readOptOut(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>).whatsapp_opt_out === true;
}

export async function getWhatsappRecipients(
  userIds: string[]
): Promise<Map<string, WhatsappRecipient>> {
  const out = new Map<string, WhatsappRecipient>();
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return out;

  const client = getSupabaseClient();
  if (!client) return out;

  const { data, error } = await client
    .from("itd_users")
    .select("id, full_name, phone, metadata")
    .in("id", ids);

  if (error) {
    logSupabaseError("getWhatsappRecipients", error);
    return out;
  }

  for (const row of data ?? []) {
    out.set(row.id as string, {
      id: row.id as string,
      full_name: (row.full_name as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      optedOut: readOptOut(row.metadata),
    });
  }
  return out;
}

export async function getWhatsappRecipient(
  userId: string
): Promise<WhatsappRecipient | null> {
  const map = await getWhatsappRecipients([userId]);
  return map.get(userId) ?? null;
}

/**
 * Honour a STOP.
 *
 * Keyed on phone rather than user id because the inbound message carries a
 * number and nothing else. A number with no account is not an error — someone
 * who received an OTP and never signed up can still say stop, and there is
 * simply nowhere to record it, so the send that would have followed is an OTP
 * they asked for anyway.
 */
export async function setWhatsappOptOut(
  phone: string,
  optedOut: boolean
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { data, error } = await client
    .from("itd_users")
    .select("id, metadata")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    logSupabaseError("setWhatsappOptOut:read", error);
    return false;
  }
  if (!data) return false;

  const current =
    data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? (data.metadata as Record<string, unknown>)
      : {};

  const { error: writeError } = await client
    .from("itd_users")
    .update({
      metadata: { ...current, whatsapp_opt_out: optedOut },
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.id);

  if (writeError) {
    logSupabaseError("setWhatsappOptOut:write", writeError);
    return false;
  }
  return true;
}
