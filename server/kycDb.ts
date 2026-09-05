import { supabase } from "./supabaseClient.js";
import { decryptField, encryptField } from "./fieldCrypto.js";
import type { OcrColumns } from "./accountDocsDb.js";

export type KycDocumentRow = {
  id: string;
  /** Smart OCR's verdict — see server/cashfreeOcr.ts. Null on pre-OCR rows. */
  ocr_status?: string | null;
  user_id: string;
  capability_id: string;
  document_type: string;
  document_no: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  file_data: string;
  created_at: string;
  updated_at: string;
};

export type KycDocumentMeta = Omit<KycDocumentRow, "file_data">;

function getClient() {
  if (!supabase) {
    console.error("[kycDb] supabase client is not configured");
    return null;
  }
  return supabase;
}

function logError(operation: string, error: { message?: string; code?: string } | null): void {
  console.error("[kycDb] operation failed:", {
    operation,
    message: error?.message,
    code: error?.code,
  });
}

// One literal, deliberately: PostgREST types the result from this string, and
// a concatenation defeats that and makes every read `GenericStringError`.
// `ocr_status` rides along because every surface showing a document on file
// has to be able to say whether anything actually checked it.
const META_COLUMNS =
  "id, user_id, capability_id, document_type, document_no, original_filename, mime_type, file_size_bytes, ocr_status, created_at, updated_at";

/** Metadata only — never pulls the base64 blob, which can be several MB. */
/** Undo the encryption on the way out of every read in this module. */
function decodeKycMeta(row: KycDocumentMeta): KycDocumentMeta {
  return { ...row, document_no: decryptField(row.document_no) };
}

function decodeKycRow(row: KycDocumentRow): KycDocumentRow {
  return {
    ...row,
    document_no: decryptField(row.document_no),
    file_data: decryptField(row.file_data),
  };
}

export async function getKycByUserId(userId: string): Promise<KycDocumentMeta | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("kyc_documents")
    .select(META_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logError("getKycByUserId", error);
    return null;
  }
  return data ? decodeKycMeta(data as KycDocumentMeta) : null;
}

/**
 * The KYC document behind a guest booking.
 *
 * Same row shape as getKycByUserId, owned by the staging ref instead of an
 * account. Read when ops dockets a guest order: customs is told the same thing
 * either way, because a guest produced the same documents.
 */
export async function getKycByGuestRef(guestRef: string): Promise<KycDocumentMeta | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("kyc_documents")
    .select(META_COLUMNS)
    .eq("guest_ref", guestRef)
    .maybeSingle();

  if (error) {
    logError("getKycByGuestRef", error);
    return null;
  }
  return data ? decodeKycMeta(data as KycDocumentMeta) : null;
}

/** Full row including file_data — for serving the owner their own document. */
export async function getKycFileByUserId(userId: string): Promise<KycDocumentRow | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("kyc_documents")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logError("getKycFileByUserId", error);
    return null;
  }
  return data ? decodeKycRow(data as KycDocumentRow) : null;
}

/** The same row as getKycFileByUserId, for a document a guest owns. */
export async function getKycFileByGuestRef(guestRef: string): Promise<KycDocumentRow | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("kyc_documents")
    .select("*")
    .eq("guest_ref", guestRef)
    .maybeSingle();

  if (error) {
    logError("getKycFileByGuestRef", error);
    return null;
  }
  return data ? decodeKycRow(data as KycDocumentRow) : null;
}

export async function getKycByCapabilityId(capabilityId: string): Promise<KycDocumentRow | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from("kyc_documents")
    .select("*")
    .eq("capability_id", capabilityId)
    .maybeSingle();

  if (error) {
    logError("getKycByCapabilityId", error);
    return null;
  }
  return data ? decodeKycRow(data as KycDocumentRow) : null;
}

export type UpsertKycInput = {
  /**
   * The account this document belongs to, or null on a guest booking, where
   * `guest_ref` names the owner instead. Exactly one of the two is set — the
   * table's CHECK refuses a row owned by neither.
   */
  user_id: string | null;
  guest_ref?: string | null;
  capability_id: string;
  document_type: string;
  document_no: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  file_data: string;
  /** Absent leaves the stored verdict alone; see accountDocsDb.toOcrColumns. */
  ocr?: OcrColumns;
};

export async function upsertKycDocument(input: UpsertKycInput): Promise<KycDocumentMeta | null> {
  const client = getClient();
  if (!client) return null;

  const now = new Date().toISOString();
  // One document per owner, whichever kind of owner it is. Matching on the
  // wrong column would find nothing and insert a second row, which the partial
  // unique index would then refuse.
  const ownerColumn = input.user_id ? "user_id" : "guest_ref";
  const ownerValue = input.user_id ?? input.guest_ref ?? null;
  if (!ownerValue) {
    logError("upsertKycDocument", { message: "called with neither user_id nor guest_ref" });
    return null;
  }

  const { data: existing } = await client
    .from("kyc_documents")
    .select("id, capability_id, created_at")
    .eq(ownerColumn, ownerValue)
    .maybeSingle();

  if (existing) {
    const { data, error } = await client
      .from("kyc_documents")
      .update({
        document_type: input.document_type,
        // Encrypted at rest; throws without ENCRYPTION_KEY rather than
        // writing an identity document in the clear. See server/fieldCrypto.ts.
        document_no: encryptField(input.document_no),
        original_filename: input.original_filename,
        mime_type: input.mime_type,
        // The original file's size, not the ciphertext's: it is shown back to
        // the customer and sent to ITD as the size of what they uploaded.
        file_size_bytes: input.file_size_bytes,
        file_data: encryptField(input.file_data),
        updated_at: now,
        ...(input.ocr ?? {}),
      })
      .eq(ownerColumn, ownerValue)
      .select(META_COLUMNS)
      .single();

    if (error) {
      logError("upsertKycDocument:update", error);
      return null;
    }
    return decodeKycMeta(data as KycDocumentMeta);
  }

  const { data, error } = await client
    .from("kyc_documents")
    .insert({
      user_id: input.user_id ?? null,
      guest_ref: input.guest_ref ?? null,
      capability_id: input.capability_id,
      document_type: input.document_type,
      document_no: encryptField(input.document_no),
      original_filename: input.original_filename,
      mime_type: input.mime_type,
      file_size_bytes: input.file_size_bytes,
      file_data: encryptField(input.file_data),
      created_at: now,
      updated_at: now,
      ...(input.ocr ?? {}),
    })
    .select(META_COLUMNS)
    .single();

  if (error) {
    logError("upsertKycDocument:insert", error);
    return null;
  }
  return decodeKycMeta(data as KycDocumentMeta);
}
