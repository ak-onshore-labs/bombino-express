/**
 * Delete what an abandoned signup left behind.
 *
 * Someone who starts signup, uploads an Aadhaar card and a PAN card, and never
 * finishes leaves those documents staged against a `signup_ref` that no account
 * will ever claim. Nothing collected them and nothing ever would: the rows have
 * no user_id, so they are invisible to every ops screen, and they sit there
 * indefinitely. That is the largest pile of un-owned identity data in the
 * system and the cheapest to be rid of.
 *
 * Under the DPDP Act personal data is to be erased once the purpose it was
 * collected for is done with, unless a law requires it kept. The purpose here
 * was opening an account that was never opened, and no retention obligation
 * attaches to a customer who does not exist — the customs KYC record only
 * begins once there is an account and a shipment.
 *
 * WHAT IS NOT TOUCHED. Anything with a user_id. Those belong to a real account
 * and fall under the customs retention rules, which are a separate question
 * with a much longer clock and a lawyer attached. This sweep only ever deletes
 * rows where signup_ref IS NOT NULL, which by construction means unclaimed.
 *
 * The window is deliberately generous. A signup interrupted by a dead battery
 * and resumed the next morning must still find its documents; the phone
 * verification behind it expires in ten minutes, so anything older than a day
 * or two is abandoned rather than paused. Fourteen days is well past both and
 * still far short of "indefinitely".
 */

import { supabase } from "./supabaseClient.js";
import {
  deleteGuestProfilesByRefs,
  listAbandonedGuestProfileRefs,
} from "./guestProfileDb.js";

/** Days an unclaimed signup's documents are kept before deletion. */
export const ABANDONED_SIGNUP_RETENTION_DAYS = Number(
  process.env.SIGNUP_RETENTION_DAYS ?? "14"
);

export interface SweepResult {
  cutoff: string;
  documents: number;
  identityVerifications: number;
  errors: string[];
  /** Guest profiles nobody came back for — see the note where they are swept. */
  guestProfiles: number;
}

/**
 * Delete unclaimed signup rows older than the retention window.
 *
 * Returns counts rather than throwing on a partial failure: a sweep that
 * cleared one table and not the other should say so and be re-run, not look
 * like it did nothing.
 */
/**
 * Every ref that has a booking behind it.
 *
 * These are customers, not abandoned signups. A guest ref outlives the session
 * that minted it — the same uuid comes back on every visit — so age alone no
 * longer distinguishes "nobody finished this" from "somebody has been shipping
 * with us since March".
 *
 * Returns an empty set on failure, and every caller reads that as "delete
 * nothing": a sweep that cannot tell the two apart must not guess.
 */
async function listRefsWithOrders(): Promise<Set<string>> {
  if (!supabase) return new Set();

  const { data, error } = await supabase
    .from("orders")
    .select("guest_ref")
    .not("guest_ref", "is", null);

  if (error) {
    console.error("[retention] could not read booked guest refs, sweeping nothing:", error.message);
    return new Set();
  }
  return new Set(
    (data ?? [])
      .map((row) => (row as { guest_ref: string | null }).guest_ref)
      .filter((ref): ref is string => !!ref)
  );
}

export async function sweepAbandonedSignups(
  retentionDays: number = ABANDONED_SIGNUP_RETENTION_DAYS
): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result: SweepResult = {
    cutoff,
    documents: 0,
    identityVerifications: 0,
    guestProfiles: 0,
    errors: [],
  };

  if (!supabase) {
    result.errors.push("supabase client is not configured");
    return result;
  }

  // `signup_ref IS NOT NULL` is the safety rail, not the date. A claimed row
  // has its signup_ref cleared when the account takes ownership, so this can
  // never reach a real customer's documents however old they are.
  //
  // That rail is no longer enough on its own. A signup_ref used to be
  // ephemeral, minted per browser and abandoned with the signup; it is now
  // also a guest's durable identity, handed back to them by
  // /api/guest/phone/verify on every visit. So a customer who has been
  // shipping as a guest for months carries rows that look exactly like an
  // abandoned signup: old, and owned by no account.
  //
  // The distinction is whether anything was ever booked under that ref.
  // `bookedRefs` is that set, and rows belonging to it are left alone at any
  // age. What is still swept is the original target: documents staged by
  // somebody who started signup, uploaded an Aadhaar, and never came back.
  const bookedRefs = await listRefsWithOrders();
  const isBooked = (ref: string | null): boolean => !!ref && bookedRefs.has(ref);

  for (const [table, label] of [
    ["account_documents", "documents"],
    ["identity_verifications", "identityVerifications"],
  ] as const) {
    const { data: stale, error: readError } = await supabase
      .from(table)
      .select("id, signup_ref")
      .not("signup_ref", "is", null)
      .lt("created_at", cutoff);

    if (readError) {
      result.errors.push(`${table}: ${readError.message}`);
      continue;
    }

    const rows = (stale ?? []) as Array<{ id: string; signup_ref: string | null }>;
    const sweepable = rows.filter((row) => !isBooked(row.signup_ref)).map((row) => row.id);
    if (sweepable.length === 0) continue;

    const { data: deleted, error: deleteError } = await supabase
      .from(table)
      .delete()
      .in("id", sweepable)
      .select("id");

    if (deleteError) {
      result.errors.push(`${table}: ${deleteError.message}`);
    } else {
      result[label] = deleted?.length ?? 0;
    }
  }

  // Guest profiles, and only the ones with nothing behind them.
  //
  // A profile whose ref owns an order belongs to a real customer: their orders
  // stay reachable by verifying that number, and deleting the name attached to
  // them would leave the bookings looking like a stranger's. What goes is the
  // other kind — a number verified once, a name half typed, nothing since.
  //
  // Not swept by `signup_ref IS NOT NULL` like the two tables above, because a
  // guest ref is a durable identity rather than an in-flight signup: the same
  // uuid is what /api/guest/phone/verify hands back to a returning customer.
  try {
    const abandoned = await listAbandonedGuestProfileRefs(cutoff);
    result.guestProfiles = await deleteGuestProfilesByRefs(abandoned);
  } catch (err) {
    result.errors.push(
      `guest_profiles: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Worth a log line every time, including the quiet ones: a sweep that has
  // silently stopped running looks exactly like a sweep with nothing to do.
  console.log(
    `[retention] swept abandoned signups older than ${retentionDays}d ` +
      `(before ${cutoff}): ${result.documents} document(s), ` +
      `${result.identityVerifications} identity row(s), ` +
      `${result.guestProfiles} guest profile(s)` +
      (result.errors.length > 0 ? ` — errors: ${result.errors.join("; ")}` : "")
  );

  return result;
}
