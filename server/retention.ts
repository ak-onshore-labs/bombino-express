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

/** Days an unclaimed signup's documents are kept before deletion. */
export const ABANDONED_SIGNUP_RETENTION_DAYS = Number(
  process.env.SIGNUP_RETENTION_DAYS ?? "14"
);

export interface SweepResult {
  cutoff: string;
  documents: number;
  identityVerifications: number;
  errors: string[];
}

/**
 * Delete unclaimed signup rows older than the retention window.
 *
 * Returns counts rather than throwing on a partial failure: a sweep that
 * cleared one table and not the other should say so and be re-run, not look
 * like it did nothing.
 */
export async function sweepAbandonedSignups(
  retentionDays: number = ABANDONED_SIGNUP_RETENTION_DAYS
): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result: SweepResult = {
    cutoff,
    documents: 0,
    identityVerifications: 0,
    errors: [],
  };

  if (!supabase) {
    result.errors.push("supabase client is not configured");
    return result;
  }

  // `signup_ref IS NOT NULL` is the safety rail, not the date. A claimed row
  // has its signup_ref cleared when the account takes ownership, so this can
  // never reach a real customer's documents however old they are.
  const { data: docs, error: docsError } = await supabase
    .from("account_documents")
    .delete()
    .not("signup_ref", "is", null)
    .lt("created_at", cutoff)
    .select("id");

  if (docsError) {
    result.errors.push(`account_documents: ${docsError.message}`);
  } else {
    result.documents = docs?.length ?? 0;
  }

  const { data: identities, error: identityError } = await supabase
    .from("identity_verifications")
    .delete()
    .not("signup_ref", "is", null)
    .lt("created_at", cutoff)
    .select("id");

  if (identityError) {
    result.errors.push(`identity_verifications: ${identityError.message}`);
  } else {
    result.identityVerifications = identities?.length ?? 0;
  }

  // Worth a log line every time, including the quiet ones: a sweep that has
  // silently stopped running looks exactly like a sweep with nothing to do.
  console.log(
    `[retention] swept abandoned signups older than ${retentionDays}d ` +
      `(before ${cutoff}): ${result.documents} document(s), ` +
      `${result.identityVerifications} identity row(s)` +
      (result.errors.length > 0 ? ` — errors: ${result.errors.join("; ")}` : "")
  );

  return result;
}
