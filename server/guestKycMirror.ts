/**
 * A guest's identity document, made to count at signup.
 *
 * Two tables hold identity documents, for two different readers:
 *
 *   kyc_documents      the one document of record. Written by /api/kyc/upload,
 *                      read by buildItdKycPayload when ops dockets an order.
 *                      This is what a guest produces to book.
 *   account_documents  the onboarding file. Written by /api/signup/documents,
 *                      read by the signup gates and the document centre.
 *
 * The mirror already ran one way: opening an account copies the Aadhaar from
 * account_documents into kyc_documents (routes.ts §mirrorAadhaarToKyc), so a
 * new customer's booking has the document customs needs. Nothing ran the other
 * way, so a guest who had already uploaded their Aadhaar to book was asked for
 * the same file again on the way to an account — the one piece of repetition
 * left in that path.
 *
 * This closes it. It is only possible because the two refs are now the same
 * uuid: `/api/guest/phone/verify` adopts the guest's existing ref as
 * `signupRef`, so a document staged under it as a guest is reachable under it
 * as a signup.
 *
 * Deliberately a copy, not a move. `kyc_documents` must keep its row — a guest
 * order still in flight is docketed from it — and `claimGuestOrdersForUser`
 * settles the duplicate at the moment the account is created, keeping one row
 * per account exactly as before.
 */

import { getKycFileByGuestRef } from "./kycDb.js";
import { listDocumentsBySignupRef, upsertAccountDocument } from "./accountDocsDb.js";
import type { DocSlot } from "../shared/accountSpec.js";
import type { OcrColumns } from "./accountDocsDb.js";

/**
 * Which signup slot a KYC document type can stand in for.
 *
 * Only these two. A passport, a driving licence or a GSTIN is a valid identity
 * document for a booking and is not one of the slots an account owes, so those
 * are left alone rather than filed under a slot they do not answer.
 */
const SLOT_BY_KYC_TYPE: Record<string, DocSlot> = {
  "Aadhaar Number": "aadhaar_card",
  "PAN Number": "pan_card",
};

/**
 * Copy the guest's document into the signup slot it answers, if any.
 *
 * Idempotent and non-destructive: a slot the customer has already staged wins,
 * because it is the newer of the two and the one they just chose to upload.
 *
 * Best-effort by contract — it returns the slot it filled, or null, and throws
 * nothing. Failing to seed a document must never fail the request that asked
 * for the list; the customer can always upload it again, which is exactly the
 * behaviour that existed before this file.
 */
export async function seedSignupDocumentFromGuestKyc(
  signupRef: string
): Promise<DocSlot | null> {
  try {
    const kyc = await getKycFileByGuestRef(signupRef);
    if (!kyc) return null;

    const slot = SLOT_BY_KYC_TYPE[kyc.document_type];
    if (!slot) return null;

    const staged = await listDocumentsBySignupRef(signupRef);
    if (staged.some((row) => row.doc_slot === slot)) return null;

    // The OCR verdict travels with the file. Without it the signup gates would
    // read a document that Cashfree matched as one nothing had checked, and
    // hold the account for a human to look at a document already looked at.
    const row = kyc as unknown as Partial<OcrColumns>;
    const ocr: OcrColumns | undefined = row.ocr_status
      ? {
          ocr_status: row.ocr_status,
          ocr_verification_id: row.ocr_verification_id ?? null,
          ocr_reference_id: row.ocr_reference_id ?? null,
          ocr_document_fields: row.ocr_document_fields ?? null,
          ocr_quality_checks: row.ocr_quality_checks ?? null,
          ocr_fraud_checks: row.ocr_fraud_checks ?? null,
          ocr_checked_at: row.ocr_checked_at ?? new Date().toISOString(),
        }
      : undefined;

    const seeded = await upsertAccountDocument({
      signup_ref: signupRef,
      doc_slot: slot,
      document_no: kyc.document_no,
      original_filename: kyc.original_filename,
      mime_type: kyc.mime_type,
      file_size_bytes: kyc.file_size_bytes,
      file_data: kyc.file_data,
      ocr,
    });

    if (!seeded) return null;
    console.log(`[signup] seeded ${slot} from the guest document on ${signupRef}`);
    return slot;
  } catch (err) {
    console.error("[signup] seeding from guest KYC failed:", err);
    return null;
  }
}
