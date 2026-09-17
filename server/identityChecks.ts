/**
 * The identity half of signup: what a typed document number must look like,
 * what OCR's verdict means for an upload, and how a confirmed number is
 * recorded against an in-flight signup.
 *
 * The policy these encode is deliberate and worth keeping in one place: a
 * contradiction refuses the upload, while an unreadable scan or an outage is
 * recorded as unverified and allowed through — those failures are ours, and a
 * customer cannot photograph their way out of them.
 *
 * Lifted verbatim out of the closure inside `registerRoutes`, where none of it
 * could be imported or tested. Behaviour is unchanged.
 */

import type { Request, Response } from "express";

import { DOC_SLOT_SPECS, type DocSlot, type VerifiedDocSlot } from "../shared/accountSpec.js";
import { identityFailureCode, ocrErrorCode } from "../shared/errorCatalog.js";
import {
  ocrTypeForDocSlot,
  runSmartOcr,
  skippedOcr,
  type OcrResult,
} from "./cashfreeOcr.js";
import {
  listIdentityVerificationsBySignupRef,
  upsertIdentityVerification,
  type IdentityKind,
} from "./identityDb.js";
import { signupRefForPhone, signupRefForReading } from "./signupRef.js";

/**
 * Validate the number printed on a document, where the slot asks for one.
 * Returns the value to store, or an error message. The patterns are the
 * ones the form enforces — shared/accountSpec.ts is the single source.
 */
export function normalizeDocumentNo(
  slot: DocSlot,
  raw: unknown
): { ok: true; value: string | null } | { ok: false; message: string } {
  const field = DOC_SLOT_SPECS[slot].numberField;
  if (!field) return { ok: true, value: null };

  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) {
    return { ok: false, message: `${field.label} is required` };
  }
  const value = field.uppercase ? trimmed.toUpperCase() : trimmed;
  if (!field.pattern.test(value)) {
    return { ok: false, message: field.error };
  }
  return { ok: true, value };
}

/**
 * Read the document and check it says what the customer said it says.
 *
 * Refuses the upload when OCR reads a contradicting number, the wrong kind
 * of document, or a tamper signal. Everything else — an unreadable scan, an
 * outage, no credentials — is allowed through and recorded as unverified,
 * because those failures are ours and a customer cannot photograph their way
 * out of them. See server/cashfreeOcr.ts for the full policy.
 */
export async function verifyDocumentOrRefuse(
  res: Response,
  args: {
    cashfreeType: ReturnType<typeof ocrTypeForDocSlot>;
    typedNumber: string | null;
    file: Express.Multer.File;
    tag: string;
  }
): Promise<OcrResult | null> {
  if (!args.cashfreeType || !args.typedNumber) {
    return skippedOcr("No OCR check applies to this document.");
  }

  const result = await runSmartOcr({
    documentType: args.cashfreeType,
    typedNumber: args.typedNumber,
    file: args.file.buffer,
    filename: args.file.originalname,
    mimeType: args.file.mimetype,
    tag: args.tag,
  });

  if (result.blocking) {
    // 422: the request was well-formed and we understood it — the document
    // itself is the problem.
    res.status(422).json({
      message: result.message,
      code: ocrErrorCode(result.status) ?? undefined,
      ocr: { status: result.status, verification_id: result.verification_id },
    });
    return null;
  }
  return result;
}

/* ── Identity numbers ────────────────────────────────────────────────────
 *
 * The step ahead of the document upload. Each number is collected here, and
 * the documents screen then makes the uploaded file agree with it.
 *
 *   GSTIN   proved by the GST portal returning the legal and trade names of
 *           the business, and a status of Active. The only one of the
 *           three that reaches an authority.
 *   Aadhaar not proved by anyone. Typed, checked for its Verhoeff check
 *           digit, recorded `self_declared`.
 *   PAN     not proved by anyone either, since the Income Tax lookup was
 *           removed. Typed, checked for shape, recorded `self_declared`.
 *
 * What stands behind the last two is the document uploaded at the next
 * step, which Smart OCR must read as the same number — see the header of
 * server/cashfreeIdentity.ts for what that does and does not establish.
 * The ordering still matters for all three: the number is recorded
 * first, so the OCR comparison is against a value the customer can no
 * longer change by the time the file arrives.
 *
 * Rows are staged against the session's signup_ref exactly like documents,
 * and claimed by the account at creation. See server/cashfreeIdentity.ts for
 * the vendor contract and the refusal policy.
 */

/**
 * Which identity check a KYC document type answers.
 *
 * Only these two. A passport or a driving licence is a valid identity
 * document for a booking and is not a check any account owes; a GSTIN has
 * its own endpoint, because that one is verified against the registry
 * rather than asserted.
 */
export const IDENTITY_KIND_FOR_KYC_TYPE: Record<string, IdentityKind | undefined> = {
  "Aadhaar Number": "aadhaar",
  "PAN Number": "pan",
};

export const IDENTITY_KIND_BY_SLOT: Record<VerifiedDocSlot, IdentityKind> = {
  aadhaar_card: "aadhaar",
  pan_card: "pan",
  gst_certificate: "gstin",
};

/**
 * The number recorded for each kind on this signup.
 *
 * "Recorded", not "proved" — an Aadhaar row is self_declared and nobody
 * confirmed it. The distinction does not change what this function is for:
 * whatever is here is the value the uploaded document has to agree with,
 * and the client does not get to supply a different one.
 */
export async function recordedIdentityNumbers(req: Request, phone: string): Promise<Map<IdentityKind, string>> {
  const signupRef = signupRefForReading(req, phone);
  if (!signupRef) return new Map();
  const rows = await listIdentityVerificationsBySignupRef(signupRef);
  return new Map(rows.map((row) => [row.kind, row.document_no]));
}

/**
 * Answer an identity failure.
 *
 * `rejected` is 422 — the request was understood perfectly and the authority
 * simply said no. `expired` is 410, which the form reads as "offer a fresh
 * OTP" rather than "retype". `unavailable` is 503, so nothing about it can
 * be mistaken for the customer's fault.
 */
export function sendIdentityFailure(
  res: Response,
  err: { failure: string; message: string; detail: string | null }
): void {
  if (err.detail) console.error("[signup/identity]", err.failure, "-", err.detail);
  const status = err.failure === "rejected" ? 422 : err.failure === "expired" ? 410 : 503;
  res.status(status).json({ message: err.message, failure: err.failure, code: identityFailureCode(err.failure) });
}

/**
 * Write one confirmed number against the in-flight signup.
 *
 * Answers the request itself on failure and returns false, so callers read
 * as a straight line. Minting the signup_ref here rather than at the first
 * upload is what lets identity verification come *before* any document.
 */
export async function recordIdentity(
  req: Request,
  res: Response,
  phone: string,
  input: {
    kind: IdentityKind;
    document_no: string;
    status: "verified" | "self_declared" | "bypassed";
    reference_id: string | null;
    verified_name: string | null;
    name_submitted?: string | null;
    name_match_result?: string | null;
    name_match_score?: number | null;
    details: Record<string, unknown> | null;
  }
): Promise<boolean> {
  try {
    const saved = await upsertIdentityVerification({
      signup_ref: await signupRefForPhone(req, phone),
      ...input,
    });
    if (!saved) {
      res.status(500).json({ message: "Could not record the verification. Please try again." });
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[signup/identity] failed to record ${input.kind}:`, err);
    res.status(500).json({ message: "Could not record the verification. Please try again." });
    return false;
  }
}

