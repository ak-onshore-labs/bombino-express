import { supabase } from "./supabaseClient.js";
import { decryptField, encryptField } from "./fieldCrypto.js";
import type { OcrColumns } from "./accountDocsDb.js";

export type KycDocumentRow = {
  id: string;
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

const META_COLUMNS =
  "id, user_id, capability_id, document_type, document_no, original_filename, mime_type, file_size_bytes, created_at, updated_at";

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
  user_id: string;
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
  const { data: existing } = await client
    .from("kyc_documents")
    .select("id, capability_id, created_at")
    .eq("user_id", input.user_id)
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
      .eq("user_id", input.user_id)
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
      user_id: input.user_id,
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
