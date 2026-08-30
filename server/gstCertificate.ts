/**
 * Reads the GSTIN off an uploaded GST registration certificate and says
 * whether it agrees with the number the GST portal already confirmed.
 *
 * WHY THIS IS NOT cashfreeOcr.ts. Cashfree Smart OCR takes eight document
 * types — PAN, AADHAAR, DRIVING_LICENCE, VOTER_ID, PASSPORT, VEHICLE_RC,
 * CANCELLED_CHEQUE, INVOICE — and a GST certificate is none of them. There is
 * no type to send it as, so this file does the reading instead.
 *
 * Two ways in, tried in order:
 *
 *   1. The PDF text layer. A certificate downloaded from the GST portal is a
 *      real PDF with real text, so the GSTIN comes out exactly, for free, with
 *      no third party involved. This is the overwhelmingly common case.
 *   2. An OpenAI vision call. A photograph or a scan has no text layer, and a
 *      certificate that cannot be read at all would block the account. This
 *      costs a fraction of a cent and only runs when step 1 found nothing.
 *
 * The verdicts mirror server/cashfreeOcr.ts exactly, because the two feed the
 * same ops queue and the same account-creation gate:
 *
 *   match       a GSTIN was read and it agrees
 *   mismatch    a GSTIN was read and it is a different one. Blocking.
 *   unreadable  nothing legible came out — neither route found a GSTIN
 *   unavailable the vision fallback was needed and could not run
 *
 * There is deliberately no `tampered` and no `wrong_document`: we are reading
 * text, not judging a photograph, and a file with somebody else's GSTIN on it
 * already lands in `mismatch`.
 */

import { createRequire } from "node:module";
import OpenAI from "openai";
import { validateGstin } from "../shared/gstin.js";
import type { OcrResult } from "./cashfreeOcr.js";

/**
 * pdfjs-dist ships ESM, and the server bundles to CommonJS (dist/index.cjs).
 * A bare `import` of the .mjs build therefore fails at runtime after esbuild
 * has flattened it, so the legacy build is pulled through createRequire at the
 * point of use instead.
 */
const requireFromHere = createRequire(import.meta.url);

/** GST portal certificates are small; anything larger is not one. */
const MAX_VISION_BYTES = 5 * 1024 * 1024;
/** A vision call must not hang an upload the way a slow OCR must not. */
const VISION_TIMEOUT_MS = 25_000;
/** Cheapest model that reads a document reliably. */
const VISION_MODEL = "gpt-4o-mini";

/** The 15-character GSTIN shape, for finding one loose in a page of text. */
const GSTIN_PATTERN = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;

export type GstExtractionSource = "pdf_text" | "vision" | null;

export interface GstCertificateCheck extends OcrResult {
  /** Which route actually produced a number, for the server log and ops. */
  source: GstExtractionSource;
}

function result(
  partial: Pick<OcrResult, "status" | "blocking" | "message"> &
    Partial<OcrResult> & { source?: GstExtractionSource }
): GstCertificateCheck {
  return {
    verification_id: null,
    reference_id: null,
    document_fields: null,
    quality_checks: null,
    fraud_checks: null,
    error: null,
    source: null,
    ...partial,
  };
}

/**
 * Pull every GSTIN-shaped string out of a PDF's text layer.
 *
 * Returns an empty array for a scanned PDF, which has no text layer at all —
 * that is the signal to try the vision route, not an error.
 */
async function gstinsFromPdfText(file: Buffer): Promise<string[]> {
  let pdfjs: {
    getDocument: (args: unknown) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
        }>;
      }>;
    };
  };
  try {
    pdfjs = requireFromHere("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (err) {
    console.error("[gstCertificate] pdfjs-dist unavailable:", err);
    return [];
  }

  try {
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(file),
      // No network fetches for fonts or maps: this runs server-side on an
      // untrusted upload, and text extraction does not need either.
      useSystemFonts: false,
      isEvalSupported: false,
    }).promise;

    let text = "";
    for (let page = 1; page <= doc.numPages; page += 1) {
      const content = await (await doc.getPage(page)).getTextContent();
      // Joined with spaces because a GSTIN is routinely split across text
      // items by the portal's layout; the spaces are stripped again below.
      text += content.items.map((item) => item.str ?? "").join(" ") + "\n";
    }
    return findGstins(text);
  } catch (err) {
    // A corrupt or encrypted PDF is not readable, which is a verdict, not a
    // crash. The vision route gets its turn next.
    console.error(
      "[gstCertificate] PDF text extraction failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Every GSTIN in a blob of text, deduplicated and checksum-checked.
 *
 * Checked because a certificate contains other 15-character strings, and the
 * mod-36 checksum is what separates a real GSTIN from a reference number that
 * happens to fit the shape. Searched twice: once as laid out, once with all
 * whitespace removed, because the portal's PDF splits the number across text
 * runs often enough to matter.
 */
function findGstins(text: string): string[] {
  const upper = text.toUpperCase();
  const found = new Set<string>();
  for (const candidate of [upper, upper.replace(/\s+/g, "")]) {
    // A fresh regex per pass: GSTIN_PATTERN is /g and carries lastIndex, so
    // reusing the shared one across two strings would skip matches.
    const pattern = new RegExp(GSTIN_PATTERN.source, "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(candidate)) !== null) {
      if (validateGstin(match[0]).valid) found.add(match[0]);
    }
  }
  return Array.from(found);
}

function isOpenAiConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY?.trim();
}

/**
 * Last resort: ask a vision model to read the GSTIN off an image.
 *
 * Only reached when the file has no usable text layer — a photograph, or a
 * scan saved as PDF. Returns null when it cannot run at all (no key, an
 * outage), which the caller reports as `unavailable` rather than as the
 * customer's fault.
 *
 * The model is asked for the number and nothing else, and whatever comes back
 * is still put through the checksum before it counts. A hallucinated GSTIN
 * fails that, so the worst case is `unreadable`, never a false `match`.
 */
async function gstinFromVision(
  file: Buffer,
  mimeType: string
): Promise<{ ok: true; gstins: string[] } | { ok: false; error: string }> {
  if (!isOpenAiConfigured()) {
    return { ok: false, error: "OPENAI_API_KEY not configured" };
  }
  if (file.length > MAX_VISION_BYTES) {
    return { ok: false, error: `file too large for vision (${file.length} bytes)` };
  }
  // The vision endpoint takes images. A scanned PDF would have to be
  // rasterised first, which needs a canvas backend this project does not
  // carry, so those land in `unreadable` with an honest reason.
  if (!mimeType.startsWith("image/")) {
    return { ok: false, error: `vision fallback does not accept ${mimeType}` };
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!.trim(),
      timeout: VISION_TIMEOUT_MS,
    });
    const response = await client.chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 32,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "This is an Indian GST registration certificate. Reply with ONLY the 15-character " +
                "GSTIN printed on it, in capitals, with no spaces, punctuation or explanation. " +
                "If you cannot read a GSTIN, reply with exactly: NONE",
            },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${file.toString("base64")}` },
            },
          ],
        },
      ],
    });

    const answer = response.choices[0]?.message?.content?.trim() ?? "";
    if (!answer || answer.toUpperCase() === "NONE") return { ok: true, gstins: [] };
    return { ok: true, gstins: findGstins(answer) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "vision call failed";
    console.error("[gstCertificate] vision fallback failed:", detail);
    return { ok: false, error: detail };
  }
}

export interface CheckGstCertificateInput {
  file: Buffer;
  mimeType: string;
  /** The GSTIN the GST portal already confirmed. The number of record. */
  verifiedGstin: string;
}

/**
 * Read the certificate and check it carries the GSTIN we verified.
 *
 * Never throws — every path returns a verdict, because an exception here would
 * fail an upload for a reason that is ours.
 *
 * A certificate carrying *several* valid GSTINs counts as a match if ours is
 * among them. That is not a loophole: a business with more than one
 * registration legitimately appears on its own paperwork, and the number we
 * are confirming being present is the whole question.
 */
export async function checkGstCertificate(
  input: CheckGstCertificateInput
): Promise<GstCertificateCheck> {
  const expected = input.verifiedGstin.trim().toUpperCase();

  let gstins: string[] = [];
  let source: GstExtractionSource = null;
  let visionError: string | null = null;

  if (input.mimeType === "application/pdf") {
    gstins = await gstinsFromPdfText(input.file);
    if (gstins.length > 0) source = "pdf_text";
  }

  if (gstins.length === 0) {
    const vision = await gstinFromVision(input.file, input.mimeType);
    if (vision.ok) {
      gstins = vision.gstins;
      if (gstins.length > 0) source = "vision";
    } else {
      visionError = vision.error;
    }
  }

  if (gstins.length === 0) {
    // A PDF we read cleanly that simply had no GSTIN on it is the customer's
    // problem to fix; a vision route that could not run is ours. Both leave
    // the document unverified, so both block the account — but only one of
    // them is worth telling the customer to re-photograph.
    if (visionError && !isOpenAiConfigured()) {
      return result({
        status: "unavailable",
        blocking: false,
        message: "We could not check this certificate just now. Please try again in a moment.",
        error: visionError,
      });
    }
    return result({
      status: "unreadable",
      blocking: false,
      message:
        "We could not find a GST number on this certificate. Please upload the certificate downloaded from the GST portal.",
      error: visionError,
      document_fields: { gstins_found: [] },
    });
  }

  if (!gstins.includes(expected)) {
    return result({
      status: "mismatch",
      blocking: true,
      message: `This certificate is for GST number ${gstins[0]}, not ${expected}. Please upload the certificate for the GST number you entered.`,
      document_fields: { gstins_found: gstins, expected },
      source,
    });
  }

  return result({
    status: "match",
    blocking: false,
    message: "GST certificate verified.",
    document_fields: { gstins_found: gstins, expected },
    source,
  });
}
