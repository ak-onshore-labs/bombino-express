/**
 * Cashfree VRS Smart OCR — reads the number off an uploaded identity document
 * and says whether it agrees with the number of record.
 *
 * For the identity slots that number is not what this request carried: it is
 * the value recorded at the identity step, which routes.ts substitutes for
 * whatever the upload supplied. It may be masked; see compareNumbers.
 *
 * For Aadhaar and PAN alike that substitution is the whole of the check.
 * Nothing verifies either number with an authority any more — not UIDAI, not
 * the Income Tax Department — so all this proves is that the document
 * uploaded reads as the number typed one screen earlier. It is still worth
 * running: it is what stops a typed number and an unrelated document both
 * being accepted. What it cannot do is tell whose document it is, because it
 * reads numbers and never names. See server/cashfreeIdentity.ts.
 *
 *   POST {base}/verification/bharat-ocr   multipart/form-data
 *   headers: x-client-id, x-client-secret, x-api-version
 *   https://www.cashfree.com/docs/api-reference/vrs/v2/smart-ocr/smart-ocr
 *
 * The policy this file implements, decided with the client:
 *
 *   • A document that reads as a *different* number, or as the wrong kind of
 *     document, or that carries a tamper signal, is refused. That is bad data,
 *     and it reaches Indian customs if we let it through.
 *   • A document that merely cannot be read — blur, glare, an outage, an empty
 *     VRS balance — does not fail the *upload*. The row is stored with its
 *     verdict, so the attempt is visible to ops and the customer keeps the
 *     file they chose, and they are told to try a clearer photo.
 *
 * `blocking` marks only the first group, so only those refuse the upload.
 *
 * Account creation is stricter than either: assertDocumentsStaged (routes.ts)
 * refuses to open an account unless every identity document came back `match`.
 * An unread document therefore costs a retry, not an unverified account — and
 * while Cashfree is unreachable, no account can open at all. That is the
 * deliberate trade, so the copy below never promises a manual check.
 */

import crypto from "crypto";
import { OCR_SLOT_DOCUMENT_TYPES, isOcrCheckedSlot } from "../shared/accountSpec.js";

const SANDBOX_BASE = "https://sandbox.cashfree.com";
const PRODUCTION_BASE = "https://api.cashfree.com";
const DEFAULT_API_VERSION = "2024-12-01";
/** Comfortably past Cashfree's own latency; a slow OCR must not hang an upload. */
const REQUEST_TIMEOUT_MS = 20_000;

/** The subset of Cashfree's document types we ever send. */
export type CashfreeDocumentType =
  | "PAN"
  | "AADHAAR"
  | "DRIVING_LICENCE"
  | "VOTER_ID"
  | "PASSPORT";

export type OcrStatus =
  /** OCR read the document and the number agrees with what was typed. */
  | "match"
  /** OCR read a different number. Blocking. */
  | "mismatch"
  /** The file is not the kind of document that slot asked for. Blocking. */
  | "wrong_document"
  /** Tamper signal from Cashfree's fraud checks. Blocking. */
  | "tampered"
  /** Cashfree answered but could not extract — blur, glare, a bad scan. */
  | "unreadable"
  /** We never got an answer: not configured, timed out, out of balance, 5xx. */
  | "unavailable"
  /** This document type has no OCR equivalent (GST certificate, a bill). */
  | "skipped"
  /** OCR_BYPASS=1 — the check was never run. See isOcrBypassed below. */
  | "bypassed";

export interface OcrResult {
  status: OcrStatus;
  /** True only for the statuses that must refuse the upload. */
  blocking: boolean;
  /** Shown to the customer. Written to be actionable, not to blame them. */
  message: string;
  /** Cashfree's own id for the call, for support tickets. */
  verification_id: string | null;
  reference_id: number | null;
  /** Raw extraction, kept for ops. May hold a masked Aadhaar. */
  document_fields: Record<string, unknown> | null;
  quality_checks: Record<string, boolean | null> | null;
  fraud_checks: Record<string, boolean | null> | null;
  /** Set when we never reached a verdict, for the server log. */
  error: string | null;
}

interface SmartOcrResponse {
  verification_id?: string;
  /**
   * Documented as an integer, returned as a quoted string by the live sandbox
   * ("127578"). Read through `toReferenceId`, never used raw.
   */
  reference_id?: number | string;
  status?: string;
  document_type?: string;
  document_fields?: Record<string, unknown>;
  quality_checks?: Record<string, boolean | null>;
  fraud_checks?: Record<string, boolean | null>;
}

function getConfig(): { clientId: string; clientSecret: string; base: string; apiVersion: string } | null {
  const clientId = process.env.CASHFREE_VRS_CLIENT_ID?.trim();
  const clientSecret = process.env.CASHFREE_VRS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  return {
    clientId,
    clientSecret,
    // Anything other than an explicit "production" is sandbox. Getting this
    // wrong costs real money against a real balance, so it fails safe.
    base: process.env.CASHFREE_VRS_ENV?.trim() === "production" ? PRODUCTION_BASE : SANDBOX_BASE,
    apiVersion: process.env.CASHFREE_VRS_API_VERSION?.trim() || DEFAULT_API_VERSION,
  };
}

export function isOcrConfigured(): boolean {
  return getConfig() !== null;
}

/**
 * TEMPORARY — the document-verification bypass.
 *
 * There is no Cashfree production account yet, and the sandbox answers every
 * image with the same canned PAN ("ABCPV1234D") and Aadhaar ("123456789012").
 * Against a real document the sandbox therefore always reads a different
 * number, that is a blocking `mismatch`, and — because assertDocumentsStaged
 * refuses an account whose identity documents are not verified — nobody can
 * register at all. This flag makes the check not run:
 *
 *   OCR_BYPASS=1
 *
 * The upload still happens and the file is still stored, exactly as before.
 * Only the verdict is missing, recorded as `bypassed` so such a row can be
 * told apart from one OCR had nothing to say about (`skipped`), one it could
 * not read (`unreadable`), and one it read and agreed with (`match`).
 * assertDocumentsStaged accepts `bypassed`, so accounts open again; the ops
 * index on ocr_status still lists every row that went in without a match.
 *
 * IDENTITY DOCUMENTS ARE NOT CHECKED AGAINST THE NUMBERS TYPED WHILE THIS IS
 * SET. A customer can upload anything for their PAN and type any number.
 *
 * Deliberately NOT gated on NODE_ENV, for the same reason PAYMENTS_TEST_MODE
 * is not: the client tests on a deployed staging build where NODE_ENV is
 * production, and that is the environment this is for. Unset it before this
 * environment has real customers, and delete the flag once VRS production
 * credentials exist.
 */
export function isOcrBypassed(): boolean {
  return process.env.OCR_BYPASS === "1";
}

/** The result stored against a document the bypass let through unchecked. */
export function bypassedOcr(): OcrResult {
  return {
    status: "bypassed",
    blocking: false,
    message: "Document uploaded. Verification is switched off in this environment.",
    verification_id: null,
    reference_id: null,
    document_fields: null,
    quality_checks: null,
    fraud_checks: null,
    error: null,
  };
}

/** Called once at boot. Silent when the flag is off. */
export function warnIfOcrBypassEnabled(): void {
  if (!isOcrBypassed()) return;

  const where = process.env.NODE_ENV === "production" ? "a PRODUCTION build" : "development";

  console.warn(
    [
      "",
      "  ############################################################",
      "  ##  OCR_BYPASS=1",
      "  ##  Identity documents are stored WITHOUT being verified.",
      "  ##  Any file, and any number typed against it, is accepted.",
      `  ##  Running in ${where}.`,
      "  ##  Unset this before this environment has real customers.",
      "  ############################################################",
      "",
    ].join("\n")
  );
}

/** `verification_id`: max 50 chars, alphanumeric plus `.`, `-`, `_`, unique per call. */
function newVerificationId(tag: string): string {
  const safeTag = tag.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 16);
  return `bmb-${safeTag}-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** Cashfree's reference id, whichever of the two shapes it arrives in. */
function toReferenceId(value: number | string | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function unavailable(message: string, error: string): OcrResult {
  return {
    status: "unavailable",
    blocking: false,
    message,
    verification_id: null,
    reference_id: null,
    document_fields: null,
    quality_checks: null,
    fraud_checks: null,
    error,
  };
}

/** Digits and letters only, upper-cased — how both sides of a comparison are held. */
function normalize(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Pull the identifying number out of `document_fields`.
 *
 * The key differs per document type, and Aadhaar comes back under `uid` on
 * both the front and back variants. Unknown shapes return null, which lands
 * the call in `unreadable` rather than a false mismatch.
 */
function extractNumber(
  documentType: CashfreeDocumentType,
  fields: Record<string, unknown> | undefined
): string | null {
  if (!fields) return null;
  const keys: Record<CashfreeDocumentType, string[]> = {
    PAN: ["pan", "pan_number"],
    AADHAAR: ["uid", "aadhaar", "aadhaar_number"],
    DRIVING_LICENCE: ["dl_number", "licence_number", "license_number", "dl"],
    VOTER_ID: ["epic_number", "voter_id", "epic"],
    PASSPORT: ["passport_number", "file_number", "passport"],
  };
  for (const key of keys[documentType]) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** `XXXXXXXX1234` or `****1234` — a number that discloses only its tail. */
function isMaskedNumber(raw: string, normalized: string): boolean {
  return /X{2,}/.test(normalized) || /\*{2,}/.test(raw);
}

/**
 * Compare what OCR read against the number of record.
 *
 * Masking can arrive from either side, and both are routine:
 *
 *   • OCR reads a masked e-Aadhaar, the download UIDAI hands out and people
 *     upload — so `extracted` is masked.
 *   • An older Aadhaar row, recorded while DigiLocker was still in use, holds
 *     the masked `uid` DigiLocker returned — so `expected` is masked. New
 *     rows never are, since the customer now types all twelve digits, but
 *     accounts created before the switch still carry them.
 *
 * Either way the honest comparison is on the last four digits, which is all a
 * masked value discloses. Comparing a masked value in full would reject the
 * genuine article; comparing on four digits is what the document itself
 * permits. Two unmasked values are still compared whole.
 */
function compareNumbers(
  extracted: string,
  expected: string
): "match" | "mismatch" | "inconclusive" {
  const expectedNorm = normalize(expected);
  const extractedNorm = normalize(extracted);
  if (!expectedNorm || !extractedNorm) return "inconclusive";

  const eitherMasked =
    isMaskedNumber(extracted, extractedNorm) || isMaskedNumber(expected, expectedNorm);

  if (eitherMasked) {
    const extractedDigits = extractedNorm.replace(/[^0-9]/g, "");
    const expectedDigits = expectedNorm.replace(/[^0-9]/g, "");
    if (extractedDigits.length < 4 || expectedDigits.length < 4) return "inconclusive";
    return extractedDigits.slice(-4) === expectedDigits.slice(-4) ? "match" : "mismatch";
  }

  return extractedNorm === expectedNorm ? "match" : "mismatch";
}

/**
 * Cashfree's tamper signals.
 *
 * `is_screenshot` and `is_photo_of_screen` are deliberately *not* here: people
 * photograph a screen holding a genuine document often enough that blocking on
 * it would cost more good customers than it catches bad ones. They are still
 * stored, so ops can look.
 */
const TAMPER_FLAGS = ["is_photo_imposed", "is_overwritten", "is_forged"] as const;

function tamperSignal(fraudChecks: Record<string, boolean | null> | undefined): string | null {
  if (!fraudChecks) return null;
  for (const flag of TAMPER_FLAGS) {
    if (fraudChecks[flag] === true) return flag;
  }
  return null;
}

export interface RunSmartOcrInput {
  documentType: CashfreeDocumentType;
  /**
   * The number of record, compared against what OCR reads.
   *
   * Not what the customer typed: for the two identity slots this is the value
   * an authority already confirmed at the identity step, which routes.ts
   * substitutes for anything the upload carried. It may be masked — see
   * compareNumbers.
   */
  typedNumber: string;
  file: Buffer;
  /** The customer's own filename. Never sent as-is — see safeUploadName. */
  filename: string;
  mimeType: string;
  /** Goes into `verification_id` so a support ticket can be traced back. */
  tag: string;
}

/**
 * A filename Cashfree will accept.
 *
 * Their multipart endpoint validates the *name*, not just the bytes, and
 * answers a name it dislikes with
 *
 *   400 {"code":"file_name_invalid","message":"File name is invalid"}
 *
 * which this file could only report as `unavailable` — "try again in a
 * moment" — for a document that would never be accepted however many times it
 * was retried. Phones produce exactly the names it rejects: a photo shared
 * over WhatsApp arrives as `WhatsApp Image 2026-08-24 at 19.02.04.jpeg`,
 * spaces and all.
 *
 * So the customer's name is not sent. It has no bearing on what OCR reads,
 * the vendor never needs it, and account_documents.original_filename keeps the
 * real one for anyone who does. What goes up is derived from the slot and the
 * MIME type: `aadhaar-<id>.jpeg`.
 *
 * The id keeps two uploads of the same slot distinguishable in Cashfree's own
 * logs, which is the only place this string is ever read.
 */
function safeUploadName(
  original: string,
  mimeType: string,
  documentType: CashfreeDocumentType
): string {
  const byMime: Record<string, string> = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "application/pdf": "pdf",
  };
  // The MIME type decides, not the customer's extension: multer already
  // refused anything outside these three, and a name can claim anything.
  const ext =
    byMime[mimeType.toLowerCase()] ??
    (original.toLowerCase().match(/\.(jpe?g|png|pdf)$/)?.[1] ?? "jpg");

  const slot = documentType.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${slot}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}.${ext}`;
}

/**
 * Run one OCR check. Never throws — every failure path returns an OcrResult,
 * because an exception here would fail an upload for a reason that is ours.
 */
export async function runSmartOcr(input: RunSmartOcrInput): Promise<OcrResult> {
  // Ahead of getConfig, so the bypass works with no credentials at all and
  // spends nothing against the VRS balance. Logged for every document: a
  // silent bypass is how one survives into production unnoticed.
  if (isOcrBypassed()) {
    console.warn(
      `[cashfreeOcr] OCR_BYPASS=1 — ${input.documentType} stored unverified (${input.tag})`
    );
    return bypassedOcr();
  }

  const config = getConfig();
  if (!config) {
    return unavailable(
      "Document verification is not switched on, so this document cannot be accepted yet.",
      "CASHFREE_VRS_CLIENT_ID/SECRET not configured"
    );
  }

  const verificationId = newVerificationId(input.tag);
  const form = new FormData();
  form.append("verification_id", verificationId);
  form.append("document_type", input.documentType);
  form.append(
    "file",
    new Blob([new Uint8Array(input.file)], { type: input.mimeType }),
    safeUploadName(input.filename, input.mimeType, input.documentType)
  );

  let res: Response;
  try {
    res = await fetch(`${config.base}/verification/bharat-ocr`, {
      method: "POST",
      headers: {
        "x-client-id": config.clientId,
        "x-client-secret": config.clientSecret,
        "x-api-version": config.apiVersion,
      },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "network error";
    console.error("[cashfreeOcr] request failed:", detail);
    return unavailable(
      "We could not verify this document just now. Please try again in a moment.",
      detail
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 401/403 is our configuration, 422 is our balance, 5xx is their outage —
    // none of them are the customer's problem, so none of them block.
    console.error("[cashfreeOcr] non-OK response:", res.status, body.slice(0, 500));
    return unavailable(
      "We could not verify this document just now. Please try again in a moment.",
      `HTTP ${res.status}: ${body.slice(0, 200)}`
    );
  }

  let body: SmartOcrResponse;
  try {
    body = (await res.json()) as SmartOcrResponse;
  } catch (err) {
    return unavailable(
      "We could not verify this document just now. Please try again in a moment.",
      err instanceof Error ? err.message : "unparseable response"
    );
  }

  const base = {
    verification_id: body.verification_id ?? verificationId,
    reference_id: toReferenceId(body.reference_id),
    document_fields: body.document_fields ?? null,
    quality_checks: body.quality_checks ?? null,
    fraud_checks: body.fraud_checks ?? null,
    error: null,
  };

  const tampered = tamperSignal(body.fraud_checks);
  if (tampered) {
    return {
      ...base,
      status: "tampered",
      blocking: true,
      message:
        "This document looks altered. Please upload an unedited photo or scan of the original.",
    };
  }

  if (body.status !== "VALID") {
    return {
      ...base,
      status: "unreadable",
      blocking: false,
      message: "We could not read this document clearly. Please upload a sharper photo of the original.",
    };
  }

  // A VALID read of the wrong kind of document is the customer putting a file
  // in the wrong slot, and it is worth saying so plainly.
  if (body.document_type && !body.document_type.toUpperCase().startsWith(input.documentType)) {
    return {
      ...base,
      status: "wrong_document",
      blocking: true,
      message: `This looks like a ${humanDocumentType(body.document_type)}, not a ${humanDocumentType(
        input.documentType
      )}. Please upload the right document.`,
    };
  }

  const extracted = extractNumber(input.documentType, body.document_fields);
  if (!extracted) {
    return {
      ...base,
      status: "unreadable",
      blocking: false,
      message: "We could not read the number on this document. Please upload a sharper photo of the original.",
    };
  }

  const verdict = compareNumbers(extracted, input.typedNumber);
  if (verdict === "mismatch") {
    return {
      ...base,
      status: "mismatch",
      blocking: true,
      message: `The number on this document does not match the ${humanDocumentType(
        input.documentType
      )} number you entered. Please check both.`,
    };
  }
  if (verdict === "inconclusive") {
    return {
      ...base,
      status: "unreadable",
      blocking: false,
      message: "We could not read the number on this document. Please upload a sharper photo of the original.",
    };
  }

  return {
    ...base,
    status: "match",
    blocking: false,
    message: "Document verified.",
  };
}

/**
 * Which onboarding slots OCR can speak to.
 *
 * Cashfree reads identity documents; it has nothing to say about a GST
 * certificate, an IEC certificate, a utility bill or an authorization letter,
 * so those slots are `skipped` rather than sent and billed for.
 */
export function ocrTypeForDocSlot(slot: string): CashfreeDocumentType | null {
  return isOcrCheckedSlot(slot) ? OCR_SLOT_DOCUMENT_TYPES[slot] : null;
}

/** The KYC upload path names its documents differently — see KycUpload.tsx. */
export function ocrTypeForKycDocumentType(documentType: string): CashfreeDocumentType | null {
  const map: Record<string, CashfreeDocumentType> = {
    "Aadhaar Number": "AADHAAR",
    "PAN Number": "PAN",
    "Passport Number": "PASSPORT",
    "Driving Licence": "DRIVING_LICENCE",
    // GSTIN is not an identity document; Smart OCR has no type for it.
  };
  return map[documentType] ?? null;
}

/** The result stored against a document OCR was never asked about. */
export function skippedOcr(reason: string): OcrResult {
  return {
    status: "skipped",
    blocking: false,
    message: reason,
    verification_id: null,
    reference_id: null,
    document_fields: null,
    quality_checks: null,
    fraud_checks: null,
    error: null,
  };
}

function humanDocumentType(value: string): string {
  const map: Record<string, string> = {
    PAN: "PAN card",
    AADHAAR: "Aadhaar card",
    AADHAAR_FRONT: "Aadhaar card",
    AADHAAR_BACK: "Aadhaar card",
    DRIVING_LICENCE: "driving licence",
    VOTER_ID: "voter ID",
    PASSPORT: "passport",
    VEHICLE_RC: "vehicle RC",
    CANCELLED_CHEQUE: "cancelled cheque",
    INVOICE: "invoice",
  };
  return map[value.toUpperCase()] ?? value.toLowerCase().replace(/_/g, " ");
}
