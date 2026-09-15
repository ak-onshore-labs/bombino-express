/**
 * Copy an Aadhaar from the onboarding file (account_documents) into
 * kyc_documents, the one KYC document of record: buildItdKycPayload reads it
 * when an order is docketed.
 *
 * Moved out of routes.ts unchanged so the account-approval path (an ops
 * request, not the customer's) can run it too. Best-effort: logs and returns.
 */

import crypto from "crypto";
import { upsertKycDocument } from "./kycDb.js";

export type KycMirrorOwner = { userId: string; guestRef?: null } | { userId: null; guestRef: string };

export interface KycMirrorSource {
  document_no: string | null;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  file_data: string;
}

export async function mirrorAadhaarToKyc(
  owner: KycMirrorOwner,
  aadhaar: KycMirrorSource | null,
  tag: string
): Promise<boolean> {
  // NOT NULL on kyc_documents.document_no — a slot without a typed number
  // cannot be mirrored, and the Aadhaar slot always asks for one.
  if (!aadhaar?.document_no) return false;

  const mirrored = await upsertKycDocument({
    user_id: owner.userId,
    guest_ref: owner.guestRef ?? null,
    capability_id: crypto.randomUUID(),
    document_type: "Aadhaar Number",
    document_no: aadhaar.document_no,
    original_filename: aadhaar.original_filename,
    mime_type: aadhaar.mime_type,
    file_size_bytes: aadhaar.file_size_bytes,
    file_data: aadhaar.file_data,
  });
  if (!mirrored) {
    console.error(
      `[${tag}] KYC mirror failed for`,
      owner.userId ? `user ${owner.userId}` : `guest ${owner.guestRef}`
    );
  }
  return Boolean(mirrored);
}
