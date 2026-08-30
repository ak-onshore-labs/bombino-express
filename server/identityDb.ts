import { supabase } from "./supabaseClient.js";
import { decryptField, encryptField } from "./fieldCrypto.js";

/**
 * Persistence for identity_verifications — the numbers signup collected, and
 * what each one is worth. See migrations/add_identity_verifications.sql.
 *
 * Deliberately shaped like accountDocsDb.ts: same signup_ref → user_id
 * ownership handover, same "list by signup", same claim-at-creation. The two
 * halves of onboarding move together, and a reader of one should recognise
 * the other.
 *
 * Identity fields are encrypted at rest: `document_no` and `file_data` go
 * through server/fieldCrypto.ts on the way in and back out, so nothing above
 * this module handles a stored ciphertext and nothing below it holds a
 * plaintext Aadhaar. Rows written before encryption existed are plaintext and
 * decrypt to themselves until scripts/encrypt-existing-documents.ts has run.
 */

/**
 * Kept in step with the same-named type in cashfreeIdentity.ts and with the
 * CHECK constraint on identity_verifications.kind. Adding a fourth means all
 * three, plus a migration.
 */
export type IdentityKind = "aadhaar" | "pan" | "gstin";

/**
 * How much a recorded number is worth. Three states, and the difference
 * between the last two matters:
 *
 *   verified       an authority answered yes. GSTIN, normally — and older
 *                  Aadhaar and PAN rows, from when those still had lookups.
 *   self_declared  the customer typed it and no authority was asked, because
 *                  for this kind there is nobody to ask. Aadhaar and PAN,
 *                  always — the design, not a switch. What backs each is the
 *                  uploaded document, which OCR must read as this same number.
 *   bypassed       a check that normally runs was switched off by
 *                  IDENTITY_BYPASS. Nothing looked at this number at all.
 *
 * Conflating the last two would lose the only question ops actually asks of
 * this column — "which accounts opened on a check somebody switched off" —
 * because every account carries self_declared rows by design.
 */
export type IdentityStatus = "verified" | "self_declared" | "bypassed";

export type IdentityVerificationRow = {
  id: string;
  user_id: string | null;
  signup_ref: string | null;
  kind: IdentityKind;
  document_no: string;
  status: IdentityStatus;
  reference_id: string | null;
  verified_name: string | null;
  /** PAN only: the name the check was run against. See the migration. */
  name_submitted: string | null;
  name_match_result: string | null;
  name_match_score: number | null;
  details: Record<string, unknown> | null;
  verified_at: string;
  created_at: string;
  updated_at: string;
};

/**
 * Everything but `details`, for the same reason accountDocsDb leaves out the
 * OCR blobs: nothing that lists verifications needs the vendor payload.
 */
export type IdentityVerificationMeta = Omit<IdentityVerificationRow, "details">;

const META_COLUMNS =
  "id, user_id, signup_ref, kind, document_no, status, reference_id, verified_name, name_submitted, name_match_result, name_match_score, verified_at, created_at, updated_at";

function getClient() {
  if (!supabase) {
    console.error("[identityDb] supabase client is not configured");
    return null;
  }
  return supabase;
}

function logError(operation: string, error: { message?: string; code?: string } | null): void {
  console.error("[identityDb] operation failed:", {
    operation,
    message: error?.message,
    code: error?.code,
  });
}

/** Undo the encryption on the way out of every read in this module. */
function decodeIdentity(row: IdentityVerificationMeta): IdentityVerificationMeta {
  return { ...row, document_no: decryptField(row.document_no) };
}

export type UpsertIdentityVerificationInput = {
  /** Exactly one of these two identifies the owner. */
  signup_ref?: string;
  user_id?: string;
  kind: IdentityKind;
  document_no: string;
  status: IdentityStatus;
  reference_id: string | null;
  verified_name: string | null;
  name_submitted?: string | null;
  name_match_result?: string | null;
  name_match_score?: number | null;
  details: Record<string, unknown> | null;
};

/**
 * Record one confirmed number, replacing whatever was there.
 *
 * Replacing matters: a customer who mistypes their Aadhaar, gets it refused,
 * then verifies a second one must leave exactly one row behind — otherwise
 * the documents step would prefill from a number that is no longer the one
 * that was proved.
 */
export async function upsertIdentityVerification(
  input: UpsertIdentityVerificationInput
): Promise<IdentityVerificationMeta | null> {
  const client = getClient();
  if (!client) return null;

  const owner: { column: "signup_ref" | "user_id"; value: string } = input.signup_ref
    ? { column: "signup_ref", value: input.signup_ref }
    : { column: "user_id", value: input.user_id! };

  const now = new Date().toISOString();
  const payload = {
    // Throws without ENCRYPTION_KEY rather than banking a bare Aadhaar.
    document_no: encryptField(input.document_no),
    status: input.status,
    reference_id: input.reference_id,
    verified_name: input.verified_name,
    name_submitted: input.name_submitted ?? null,
    name_match_result: input.name_match_result ?? null,
    name_match_score: input.name_match_score ?? null,
    details: input.details,
    verified_at: now,
    updated_at: now,
  };

  const { data: existing } = await client
    .from("identity_verifications")
    .select("id")
    .eq(owner.column, owner.value)
    .eq("kind", input.kind)
    .maybeSingle();

  if (existing) {
    const { data, error } = await client
      .from("identity_verifications")
      .update(payload)
      .eq("id", existing.id)
      .select(META_COLUMNS)
      .single();

    if (error) {
      logError("upsertIdentityVerification:update", error);
      return null;
    }
    return decodeIdentity(data as IdentityVerificationMeta);
  }

  const { data, error } = await client
    .from("identity_verifications")
    .insert({
      [owner.column]: owner.value,
      kind: input.kind,
      ...payload,
      created_at: now,
    })
    .select(META_COLUMNS)
    .single();

  if (error) {
    logError("upsertIdentityVerification:insert", error);
    return null;
  }
  return decodeIdentity(data as IdentityVerificationMeta);
}

export async function listIdentityVerificationsBySignupRef(
  signupRef: string
): Promise<IdentityVerificationMeta[]> {
  const client = getClient();
  if (!client) return [];

  const { data, error } = await client
    .from("identity_verifications")
    .select(META_COLUMNS)
    .eq("signup_ref", signupRef)
    .order("created_at", { ascending: true });

  if (error) {
    logError("listIdentityVerificationsBySignupRef", error);
    return [];
  }
  return ((data ?? []) as IdentityVerificationMeta[]).map(decodeIdentity);
}

export async function listIdentityVerificationsByUserId(
  userId: string
): Promise<IdentityVerificationMeta[]> {
  const client = getClient();
  if (!client) return [];

  const { data, error } = await client
    .from("identity_verifications")
    .select(META_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    logError("listIdentityVerificationsByUserId", error);
    return [];
  }
  return ((data ?? []) as IdentityVerificationMeta[]).map(decodeIdentity);
}

/**
 * Hand the staged verifications to the account that was just created.
 *
 * Same contract as claimSignupDocuments: runs after the itd_users row exists,
 * and a failure leaves the rows on the signup_ref side rather than losing the
 * account.
 */
export async function claimSignupIdentityVerifications(
  signupRef: string,
  userId: string
): Promise<number> {
  const client = getClient();
  if (!client) return 0;

  const { data, error } = await client
    .from("identity_verifications")
    .update({ user_id: userId, signup_ref: null, updated_at: new Date().toISOString() })
    .eq("signup_ref", signupRef)
    .select("id");

  if (error) {
    logError("claimSignupIdentityVerifications", error);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Throw away every verification staged against an abandoned signup.
 *
 * Called when the verified phone changes mid-signup: the rows belong to the
 * number that proved them, and nothing about them carries over to a different
 * person. Leaving them would let the next signup in the same browser inherit
 * an identity somebody else proved.
 */
export async function deleteIdentityVerificationsBySignupRef(
  signupRef: string
): Promise<number> {
  const client = getClient();
  if (!client) return 0;

  const { data, error } = await client
    .from("identity_verifications")
    .delete()
    .eq("signup_ref", signupRef)
    .select("id");

  if (error) {
    logError("deleteIdentityVerificationsBySignupRef", error);
    return 0;
  }
  return data?.length ?? 0;
}
