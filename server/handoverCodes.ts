/**
 * Handover OTPs — the code one party reads out and the other types in.
 *
 * Three handovers, three codes, three different pairs of hands:
 *
 *   kind      shown to    typed in by   gates
 *   pickup    customer    agent         out_for_pickup  → picked_up
 *   hub       ops         agent         picked_up       → received_at_hub
 *   dropoff   customer    ops           awaiting_dropoff → received_at_hub
 *
 * THE ONE RULE: never return a code to the party that types it in. A verifier
 * who can read the code is not being tested by it, and the whole mechanism
 * collapses into an extra tap. `getCodeForOwner` is the only read, and every
 * caller passes the kind that party owns.
 *
 * Codes do not expire. A pickup can slip a day and the customer must still be
 * able to open the app and read the same number out. What limits abuse is the
 * attempt counter: five wrong guesses locks the code until whoever owns it
 * regenerates, which is a deliberate act by the person holding the parcel.
 *
 * THE COUNTER IS THE CONTROL, NOT THE LENGTH. Every code here is four digits:
 * 10,000 of them, and five guesses buys a 1-in-2,000 chance of hitting one
 * before the code locks — against a single parcel, read out loud, in front of
 * the person who owns it. Six digits made that 1-in-200,000 and cost two extra
 * characters typed on a doorstep with gloves on, which is the failure mode that
 * actually happens.
 *
 * Never raise `HANDOVER_MAX_ATTEMPTS` to compensate for anything. At four
 * digits it is the only thing between this and a brute force, and every digit
 * dropped makes it matter more, not less.
 */

import crypto from "crypto";
import { supabase } from "./supabaseClient.js";

export type HandoverKind = "pickup" | "hub" | "dropoff";

/** Wrong guesses tolerated before the code must be regenerated. */
export const HANDOVER_MAX_ATTEMPTS = 5;

/** What a verifier may type. Exported so the API validates the same length. */
export const HANDOVER_CODE_PATTERN = /^\d{4}$/;

/**
 * Digits in a code, minted and typed. One number, not a range.
 *
 * This briefly accepted four to six, to let codes minted before the change stay
 * typeable while their owners read them off a screen. That window is closed: a
 * handover code is four digits and a field that takes a fifth is only telling
 * the agent something false about what will be accepted.
 *
 * A six-digit code still sitting unverified in the table can no longer be
 * entered. Its owner regenerates — one tap, on the screen already showing it —
 * or ops override, which is audited. Neither strands a parcel.
 */
const CODE_LENGTH = 4;

export type HandoverCode = {
  id: string;
  order_id: string;
  kind: HandoverKind;
  code: string;
  attempts: number;
  verified_at: string | null;
  created_at: string;
};

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "no_code" | "locked" | "mismatch" | "error"; attemptsLeft: number };

function getSupabaseClient() {
  if (!supabase) {
    console.error("[handoverCodes] supabase client is not configured");
    return null;
  }
  return supabase;
}

function logSupabaseError(
  operation: string,
  error: { message?: string; code?: string } | null
): void {
  console.error("[handoverCodes] supabase operation failed:", {
    operation,
    message: error?.message,
    code: error?.code,
  });
}

/**
 * Four digits, uniformly distributed, including leading zeros.
 *
 * `randomInt` rather than `Math.random` for the same reason the auth OTP uses
 * it: this is a credential, however short-lived, and a predictable one is
 * worse than none because it looks like a control.
 */
function generateCode(): string {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/**
 * Create the code for a handover, or replace the one already there.
 *
 * Upsert on `(order_id, kind)` so regeneration overwrites rather than adding a
 * second live code — there must never be a question of which of two numbers the
 * customer is reading from.
 *
 * Called at the moment the handover becomes foreseeable, not at the moment it
 * happens: the pickup code exists from the claim, so the customer can see it
 * well before the doorbell goes.
 *
 * @returns the new code, or null on a DB error (the caller must not fail the
 *          transition over it — see the note at each call site)
 */
export async function issueCode(
  orderId: string,
  kind: HandoverKind
): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const code = generateCode();
  const { error } = await client.from("order_handover_codes").upsert(
    {
      order_id: orderId,
      kind,
      code,
      // A regenerated code is a fresh start in every sense: the old attempts
      // were against a number that no longer opens anything.
      attempts: 0,
      verified_at: null,
      verified_by: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "order_id,kind" }
  );

  if (error) {
    logSupabaseError("issueCode", error);
    return null;
  }
  return code;
}

/**
 * The code, for the party entitled to read it.
 *
 * Named for what it is allowed to do rather than what it does, because the
 * dangerous version of this function is one called with the verifier's kind.
 * Every call site must be readable as "this party owns this kind".
 */
export async function getCodeForOwner(
  orderId: string,
  kind: HandoverKind
): Promise<{ code: string; attempts: number; locked: boolean } | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("order_handover_codes")
    .select("code, attempts, verified_at")
    .eq("order_id", orderId)
    .eq("kind", kind)
    .maybeSingle();

  if (error) {
    logSupabaseError("getCodeForOwner", error);
    return null;
  }
  if (!data) return null;
  // A verified code is spent: the handover it guarded has happened, and showing
  // it again would invite someone to read out a number that opens nothing.
  if (data.verified_at) return null;

  return {
    code: data.code as string,
    attempts: Number(data.attempts ?? 0),
    locked: Number(data.attempts ?? 0) >= HANDOVER_MAX_ATTEMPTS,
  };
}

/**
 * Check what the verifier typed, and burn the code if it matches.
 *
 * A wrong guess costs an attempt whether or not the caller ever retries — the
 * counter is the only thing standing between this and an agent trying every
 * number between 000000 and 999999 on a customer's doorstep.
 *
 * Marks `verified_at` on success so the code cannot be replayed: a second
 * transition attempt with the same number finds a spent code and is refused by
 * `no_code`, which is the honest answer.
 */
export async function verifyCode(input: {
  orderId: string;
  kind: HandoverKind;
  submitted: string;
  verifiedBy: string;
}): Promise<VerifyResult> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, reason: "error", attemptsLeft: 0 };

  const { data, error } = await client
    .from("order_handover_codes")
    .select("id, code, attempts, verified_at")
    .eq("order_id", input.orderId)
    .eq("kind", input.kind)
    .maybeSingle();

  if (error) {
    logSupabaseError("verifyCode:read", error);
    return { ok: false, reason: "error", attemptsLeft: 0 };
  }
  if (!data || data.verified_at) {
    return { ok: false, reason: "no_code", attemptsLeft: 0 };
  }

  const attempts = Number(data.attempts ?? 0);
  if (attempts >= HANDOVER_MAX_ATTEMPTS) {
    return { ok: false, reason: "locked", attemptsLeft: 0 };
  }

  // Compare in constant time. The window is small and the secret is four
  // digits, but a timing-variable compare on a credential is the kind of thing
  // that is free to get right and embarrassing to explain.
  //
  // `timingSafeEqual` throws on a length mismatch, so the lengths are compared
  // first and a wrong-length guess is simply a mismatch — it still costs an
  // attempt, which is what stops length probing being free. A stored code of
  // any other length is one minted before four digits became the rule, and it
  // can no longer be matched by anything the route will accept.
  const submitted = input.submitted.trim();
  const expected = String(data.code);
  const matches =
    submitted.length === CODE_LENGTH &&
    submitted.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));

  if (!matches) {
    const { error: bumpError } = await client
      .from("order_handover_codes")
      .update({ attempts: attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      // Re-assert the count we read, so two simultaneous wrong guesses cost
      // two attempts rather than one.
      .eq("attempts", attempts);
    if (bumpError) logSupabaseError("verifyCode:bump", bumpError);

    return {
      ok: false,
      reason: "mismatch",
      attemptsLeft: Math.max(0, HANDOVER_MAX_ATTEMPTS - (attempts + 1)),
    };
  }

  const { data: burned, error: burnError } = await client
    .from("order_handover_codes")
    .update({
      verified_at: new Date().toISOString(),
      verified_by: input.verifiedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("id", data.id)
    // Only an unspent code can be spent. Two callers submitting the right code
    // at once means exactly one of them performs the transition.
    .is("verified_at", null)
    .select("id")
    .maybeSingle();

  if (burnError) {
    logSupabaseError("verifyCode:burn", burnError);
    return { ok: false, reason: "error", attemptsLeft: 0 };
  }
  if (!burned) return { ok: false, reason: "no_code", attemptsLeft: 0 };

  return { ok: true };
}

/**
 * Spend a code without checking it, for an ops override.
 *
 * The override exists because a customer's phone dies and a parcel must not be
 * stranded on their doorstep for it. It is ops-only and always leaves an
 * `order_events` row naming who did it — the audit trail is the control here,
 * not the code.
 *
 * Absent code is not an error: a dropoff that was never issued one still needs
 * the override to succeed.
 */
export async function burnCodeForOverride(input: {
  orderId: string;
  kind: HandoverKind;
  overriddenBy: string;
}): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const { error } = await client
    .from("order_handover_codes")
    .update({
      verified_at: new Date().toISOString(),
      verified_by: input.overriddenBy,
      updated_at: new Date().toISOString(),
    })
    .eq("order_id", input.orderId)
    .eq("kind", input.kind)
    .is("verified_at", null);

  if (error) logSupabaseError("burnCodeForOverride", error);
}
