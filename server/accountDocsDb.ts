import { supabase } from "./supabaseClient.js";
import {
  decryptField,
  decryptNullable,
  encryptField,
  encryptNullable,
} from "./fieldCrypto.js";
import type { DocSlot } from "../shared/accountSpec.js";
import type { OcrResult } from "./cashfreeOcr.js";

/**
 * The OCR verdict, flattened onto whichever document row it belongs to.
 * Shared by both document tables, which carry the same seven columns.
 *
 * Identity fields are encrypted at rest: `document_no` and `file_data` go
 * through server/fieldCrypto.ts on the way in and back out, so nothing above
 * this module handles a stored ciphertext and nothing below it holds a
 * plaintext Aadhaar. Rows written before encryption existed are plaintext and
 * decrypt to themselves until scripts/encrypt-existing-documents.ts has run.
 */
export type OcrColumns = {
  ocr_status: string;
  ocr_verification_id: string | null;
  ocr_reference_id: number | null;
  ocr_document_fields: Record<string, unknown> | null;
  ocr_quality_checks: Record<string, boolean | null> | null;
  ocr_fraud_checks: Record<string, boolean | null> | null;
  ocr_checked_at: string;
};

/** A blocking result never reaches storage — the upload is refused instead. */
export function toOcrColumns(result: OcrResult): OcrColumns {
  return {
    ocr_status: result.status,
    ocr_verification_id: result.verification_id,
    ocr_reference_id: result.reference_id,
    ocr_document_fields: result.document_fields,
    ocr_quality_checks: result.quality_checks,
    ocr_fraud_checks: result.fraud_checks,
    ocr_checked_at: new Date().toISOString(),
  };
}

export type AccountDocumentRow = {
  id: string;
  user_id: string | null;
  signup_ref: string | null;
  doc_slot: DocSlot;
  document_no: string | null;
  capability_id: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  file_data: string;
  created_at: string;
  updated_at: string;
  /** NULL only on rows written before OCR existed. See cashfreeOcr.ts. */
  ocr_status: string | null;
  ocr_verification_id: string | null;
  ocr_reference_id: number | null;
  ocr_document_fields: Record<string, unknown> | null;
  ocr_quality_checks: Record<string, boolean | null> | null;
  ocr_fraud_checks: Record<string, boolean | null> | null;
  ocr_checked_at: string | null;
};

/**
 * Everything but the payloads. The three OCR jsonb blobs are left out for the
 * same reason file_data is: nothing that lists documents needs them, and they
 * are unbounded.
 */
export type AccountDocumentMeta = Omit<
  AccountDocumentRow,
  "file_data" | "ocr_document_fields" | "ocr_quality_checks" | "ocr_fraud_checks"
>;

const META_COLUMNS =
  "id, user_id, signup_ref, doc_slot, document_no, capability_id, original_filename, mime_type, file_size_bytes, created_at, updated_at, ocr_status, ocr_verification_id, ocr_reference_id, ocr_checked_at";

function getClient() {
  if (!supabase) {
    console.error("[accountDocsDb] supabase client is not configured");
    return null;
  }
  return supabase;
}

function logError(operation: string, error: { message?: string; code?: string } | null): void {
  console.error("[accountDocsDb] operation failed:", {
    operation,
    message: error?.message,
    code: error?.code,
  });
}

/** Undo the encryption on the way out of every read in this module. */
function decodeMeta(row: AccountDocumentMeta): AccountDocumentMeta {
  return { ...row, document_no: decryptNullable(row.document_no) };
}

function decodeRow(row: AccountDocumentRow): AccountDocumentRow {
  return {
    ...row,
    document_no: decryptNullable(row.document_no),
    file_data: decryptField(row.file_data),
  };
}

export type UpsertAccountDocumentInput = {
  /** Exactly one of these two identifies the owner. */
  signup_ref?: string;
  user_id?: string;
  doc_slot: DocSlot;
  document_no: string | null;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  file_data: string;
  ocr?: OcrColumns;
};

/**
 * Write one slot, replacing whatever was there.
 *
 * `capability_id` survives a replacement — the id is handed out in URLs, and
 * re-uploading a clearer scan of the same bill should not invalidate them.
 */
export async function upsertAccountDocument(
  input: UpsertAccountDocumentInput
): Promise<AccountDocumentMeta | null> {
  const client = getClient();
  if (!client) return null;

  const owner: { column: "signup_ref" | "user_id"; value: string } = input.signup_ref
    ? { column: "signup_ref", value: input.signup_ref }
    : { column: "user_id", value: input.user_id! };

  const now = new Date().toISOString();
  const { data: existing } = await client
    .from("account_documents")
    .select("id, capability_id")
    .eq(owner.column, owner.value)
    .eq("doc_slot", input.doc_slot)
    .maybeSingle();

  // Throws when ENCRYPTION_KEY is absent, which fails the upload rather than
  // writing an identity document in the clear.
  const payload = {
    document_no: encryptNullable(input.document_no),
    original_filename: input.original_filename,
    mime_type: input.mime_type,
    // file_size_bytes stays the size of the ORIGINAL file, not the ciphertext:
    // it is shown to the customer and sent to ITD as the size of their upload.
    file_size_bytes: input.file_size_bytes,
    file_data: encryptField(input.file_data),
    updated_at: now,
    ...(input.ocr ?? {}),
  };

  if (existing) {
    const { data, error } = await client
      .from("account_documents")
      .update(payload)
      .eq("id", existing.id)
      .select(META_COLUMNS)
      .single();

    if (error) {
      logError("upsertAccountDocument:update", error);
      return null;
    }
    return decodeMeta(data as AccountDocumentMeta);
  }

  const { data, error } = await client
    .from("account_documents")
    .insert({
      [owner.column]: owner.value,
      doc_slot: input.doc_slot,
      ...payload,
      created_at: now,
    })
    .select(META_COLUMNS)
    .single();

  if (error) {
    logError("upsertAccountDocument:insert", error);
    return null;
  }
  return decodeMeta(data as AccountDocumentMeta);
}

/** Metadata only — the base64 blobs are megabytes and nothing here needs them. */
export async function listDocumentsBySignupRef(
  signupRef: string
): Promise<AccountDocumentMeta[]> {
  const client = getClient();
  if (!client) return [];

  const { data, error } = await client
    .from("account_documents")
    .select(META_COLUMNS)
    .eq("signup_ref", signupRef)
    .order("created_at", { ascending: true });

  if (error) {
    logError("listDocumentsBySignupRef", error);
    return [];
  }
  return ((data ?? []) as AccountDocumentMeta[]).map(decodeMeta);
}

export async function listDocumentsByUserId(userId: string): Promise<AccountDocumentMeta[]> {
  const client = getClient();
  if (!client) return [];

  const { data, error } = await client
    .from("account_documents")
    .select(META_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    logError("listDocumentsByUserId", error);
    return [];
  }
  return ((data ?? []) as AccountDocumentMeta[]).map(decodeMeta);
}

export async function getAccountDocumentByCapabilityId(
  capabilityId: string
): Promise<AccountDocumentRow | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("account_documents")
    .select("*")
    .eq("capability_id", capabilityId)
    .maybeSingle();

  if (error) {
    logError("getAccountDocumentByCapabilityId", error);
    return null;
  }
  return data ? decodeRow(data as AccountDocumentRow) : null;
}

/** The base64 blob for one slot of one owner — used to mirror Aadhaar into kyc_documents. */
export async function getSignupDocumentWithFile(
  signupRef: string,
  docSlot: DocSlot
): Promise<AccountDocumentRow | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("account_documents")
    .select("*")
    .eq("signup_ref", signupRef)
    .eq("doc_slot", docSlot)
    .maybeSingle();

  if (error) {
    logError("getSignupDocumentWithFile", error);
    return null;
  }
  return data ? decodeRow(data as AccountDocumentRow) : null;
}

export async function deleteSignupDocument(
  signupRef: string,
  docSlot: DocSlot
): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  const { error } = await client
    .from("account_documents")
    .delete()
    .eq("signup_ref", signupRef)
    .eq("doc_slot", docSlot);

  if (error) {
    logError("deleteSignupDocument", error);
    return false;
  }
  return true;
}

/**
 * Hand the staged documents to the account that was just created.
 *
 * Runs *after* the itd_users row exists, so the FK is satisfiable. If it
 * fails the account still stands and the rows keep their signup_ref, which is
 * recoverable (the customer re-uploads) rather than lost.
 */
export async function claimSignupDocuments(
  signupRef: string,
  userId: string
): Promise<number> {
  const client = getClient();
  if (!client) return 0;

  const { data, error } = await client
    .from("account_documents")
    .update({ user_id: userId, signup_ref: null, updated_at: new Date().toISOString() })
    .eq("signup_ref", signupRef)
    .select("id");

  if (error) {
    logError("claimSignupDocuments", error);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Throw away every document staged against an abandoned signup.
 *
 * The companion to deleteIdentityVerificationsBySignupRef: when the verified
 * phone changes mid-signup, the uploads belong to the number that made them.
 */
export async function deleteAllSignupDocuments(signupRef: string): Promise<number> {
  const client = getClient();
  if (!client) return 0;

  const { data, error } = await client
    .from("account_documents")
    .delete()
    .eq("signup_ref", signupRef)
    .select("id");

  if (error) {
    logError("deleteAllSignupDocuments", error);
    return 0;
  }
  return data?.length ?? 0;
}
