/**
 * One explanation for each document problem, the same on the upload screens
 * (AccountDocuments, KycUpload) as in BIA (explain_document_issue, and the
 * document lists in get_signup_progress / get_document_status).
 *
 * Built on the error catalog: the words are the catalog's, so an upload
 * screen, BIA's SCREEN block and BIA's tools can't drift apart. What this file
 * adds is which problems count as document problems, the reader's verdicts
 * mapped onto them, and the label for the control that retries.
 *
 * Nothing is explained for `match`, `bypassed` or `skipped`. A match needs no
 * words; `bypassed` is the check switched off while Cashfree runs on test
 * credentials, which the customer is never told about; `skipped` is a document
 * nothing reads (a bill, the IEC certificate).
 */

import { ERROR_CATALOG, isErrorCode, ocrErrorCode, type ErrorButton, type ErrorCode } from "./errorCatalog.js";

/**
 * The document reader's verdicts: server/cashfreeOcr.ts `OcrStatus`, shared by
 * the GST certificate reader. Mirrored here because the client can't import
 * server code; shared/ocrExplain.test.ts fails if the two ever differ.
 */
export const OCR_VERDICTS = [
  "match",
  "mismatch",
  "wrong_document",
  "tampered",
  "unreadable",
  "unavailable",
  "skipped",
  "bypassed",
] as const;

export type OcrVerdict = (typeof OCR_VERDICTS)[number];

/** Verdicts that say nothing to the customer. */
const SILENT_VERDICTS: ReadonlySet<string> = new Set<OcrVerdict>(["match", "bypassed", "skipped"]);

/**
 * The document problems, by the name BIA's tool takes, each with its catalog
 * code. Everything else the catalog files under documents (a missing file, a
 * number in the wrong format) is a form error the screen already words well.
 */
export const DOCUMENT_ISSUES = {
  mismatch: "OCR_MISMATCH",
  wrong_document: "OCR_WRONG_DOCUMENT",
  tampered: "OCR_TAMPERED",
  unreadable: "OCR_UNREADABLE",
  unavailable: "OCR_UNAVAILABLE",
  /** A checked document with no verdict on file, e.g. from before the checks. */
  unverified: "DOCUMENTS_UNVERIFIED",
  /** Uploaded before its number was changed. */
  outdated: "DOCUMENTS_OUTDATED",
  /** A file sent before the number it's checked against. */
  number_first: "IDENTITY_NUMBER_FIRST",
  /** The GST number on the form isn't the one that was verified. */
  gstin_changed: "GSTIN_CHANGED",
} as const satisfies Record<string, ErrorCode>;

export type DocumentIssueName = keyof typeof DOCUMENT_ISSUES;

export const DOCUMENT_ISSUE_NAMES = Object.keys(DOCUMENT_ISSUES) as DocumentIssueName[];

const DOCUMENT_CODES: ReadonlySet<string> = new Set<string>(Object.values(DOCUMENT_ISSUES));

/** What the retry control says, when it's not a plain "Try again". */
const RETRY_LABELS: Partial<Record<ErrorCode, string>> = {
  OCR_MISMATCH: "Upload the right document",
  OCR_WRONG_DOCUMENT: "Upload the right document",
  OCR_TAMPERED: "Upload a photo of the original",
  OCR_UNREADABLE: "Upload a clearer photo",
  DOCUMENTS_UNVERIFIED: "Upload a clearer photo",
  DOCUMENTS_OUTDATED: "Upload it again",
};

export interface DocumentIssue {
  code: ErrorCode;
  /** What went wrong, in a few words. */
  headline: string;
  /** Why it happens. */
  why: string;
  /** What to do about it. */
  fix: string;
  /** A BIA button to the fix, when it's somewhere else. */
  button?: ErrorButton;
  /** The label for the control that picks a new file. */
  retryLabel: string;
}

export function isDocumentIssueName(value: unknown): value is DocumentIssueName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DOCUMENT_ISSUES, value);
}

function issueFor(code: ErrorCode): DocumentIssue {
  const entry: { title: string; why: string; fix: string; button?: ErrorButton } = ERROR_CATALOG[code];
  return {
    code,
    headline: entry.title,
    why: entry.why,
    fix: entry.fix,
    ...(entry.button ? { button: entry.button } : {}),
    retryLabel: RETRY_LABELS[code] ?? "Try again",
  };
}

/**
 * The explanation for a document problem, from the code the server sent with
 * a refusal or from the verdict an accepted upload came back with. A code
 * wins over a verdict: it names the exact problem.
 *
 * Null when there is nothing to explain (a match, a switched-off check, a
 * document nothing reads) or when the problem isn't a document one, in which
 * case the screen keeps its own message.
 */
export function explainDocumentIssue(input: { code?: string | null; verdict?: string | null }): DocumentIssue | null {
  if (isErrorCode(input.code) && DOCUMENT_CODES.has(input.code)) return issueFor(input.code);
  if (input.verdict == null || SILENT_VERDICTS.has(input.verdict)) return null;
  const code = ocrErrorCode(input.verdict);
  return code ? issueFor(code) : null;
}

/** The explanation for a problem named the way BIA's tool names it. */
export function explainDocumentIssueByName(name: DocumentIssueName): DocumentIssue {
  return issueFor(DOCUMENT_ISSUES[name]);
}
