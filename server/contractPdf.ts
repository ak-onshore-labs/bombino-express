/**
 * Put the signature onto the contract.
 *
 * The customer signs a document, not a description of one, so what they see
 * before they tick the box has to be the document with their own name on it —
 * and what is kept afterwards has to be the same bytes. Both come from here.
 *
 * WHERE IT GOES. Page 4 closes with two signature columns, Bombino's on the
 * left and the customer's on the right:
 *
 *   x=97.5  y=300.6   "For Bombino Express Pvt. Ltd."
 *   x=360.2 y=300.6   "For M/s"                        <- the customer's side
 *   x=97.5  y=227.2   "Authorized Signatory"
 *
 * Those coordinates were read out of the file itself rather than guessed, and
 * the stamp is placed relative to them. They are pinned to THIS document: a
 * new contract PDF almost certainly moves them, which is why replacing the
 * file means re-reading the anchors and bumping CONTRACT_VERSION together.
 *
 * WHAT IS NOT STAMPED. Page 1 has "Customer Code:" and "Sales Representative:"
 * blanks. Neither is known while the account is still being created — the
 * customer code is assigned by ITD afterwards — and filling them with a guess
 * would put false particulars on a signed contract. They stay blank, as they
 * would on paper.
 *
 * This does NOT make the document a stamped counterpart. Page 4 asks for a
 * signature and rubber stamp on all four pages by an authorised signatory;
 * this is a typed name in the signature block. Corporate accounts still hand
 * over the countersigned copy as the authorization letter. See
 * shared/contract.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * The document, as shipped to the browser.
 *
 * Read from the client build output, which is the same file the static
 * handler serves, so the signed copy can never be a different revision from
 * the one a customer could open unsigned. In development that directory is
 * the source tree; in production it is dist/public.
 */
function contractPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "dist/public/contract-2026.pdf"),
    path.resolve(process.cwd(), "client/public/contract-2026.pdf"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `contract PDF not found. Looked in: ${candidates.join(", ")}`
  );
}

/** Anchors read out of page 4 of contract-2026.pdf. */
const SIGNATURE_BLOCK = {
  /** Left edge of the customer's column, from "For M/s". */
  x: 360.2,
  /** Baseline of the "For M/s" line. */
  y: 300.6,
  /** How far right of "For M/s" the account name starts. */
  nameOffsetX: 42,
  /** Drop from "For M/s" to the signature itself. */
  signatureDy: 38,
  /** Drop from "For M/s" to the label under the signature. */
  labelDy: 62,
  /** Drop from "For M/s" to the date. */
  dateDy: 74,
} as const;

const INK = rgb(0.08, 0.15, 0.32);
const LABEL_INK = rgb(0.35, 0.35, 0.35);

export interface SignContractInput {
  /** The name typed as the signature. */
  signedName: string;
  /** Whose account it is — the individual's name, or the company's. */
  accountName: string;
  /**
   * When it was signed. Passed in rather than read from the clock here so the
   * preview and the stored copy can be given the same instant, and so the
   * value that lands on the page is the one written to contract_accepted_at.
   */
  signedAt: Date;
}

/** How the date reads on the page. Matches what the signing screen shows. */
function formatSignedOn(when: Date): string {
  return when.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/**
 * Return the contract with the signature block filled in.
 *
 * Never mutates the source file — pdf-lib works on a copy in memory, and the
 * bytes come back for the caller to serve or store.
 */
export async function signContractPdf(input: SignContractInput): Promise<Buffer> {
  const source = await fs.promises.readFile(contractPath());
  const pdf = await PDFDocument.load(source);

  const pages = pdf.getPages();
  const last = pages[pages.length - 1];
  if (!last) throw new Error("contract PDF has no pages");

  // Helvetica for the particulars and the label; the signature itself is set
  // in an italic face so it reads as a signature rather than another line of
  // form text, which is the same distinction the signing screen draws.
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const hand = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const { x, y, nameOffsetX, signatureDy, labelDy, dateDy } = SIGNATURE_BLOCK;
  const accountName = input.accountName.trim();
  const signedName = input.signedName.trim();

  if (accountName) {
    last.drawText(accountName, {
      x: x + nameOffsetX,
      y,
      size: 10,
      font: body,
      color: INK,
    });
  }

  last.drawText(signedName, {
    x,
    y: y - signatureDy,
    size: 16,
    font: hand,
    color: INK,
  });

  last.drawText("Authorized Signatory", {
    x,
    y: y - labelDy,
    size: 8,
    font: body,
    color: LABEL_INK,
  });

  last.drawText(`Signed on ${formatSignedOn(input.signedAt)}`, {
    x,
    y: y - dateDy,
    size: 8,
    font: body,
    color: LABEL_INK,
  });

  // A signed contract is a record, not a document to go on being edited.
  pdf.setTitle("Bombino Express Customer Contract (2026)");
  pdf.setSubject(`Signed by ${signedName}${accountName ? ` for ${accountName}` : ""}`);
  pdf.setModificationDate(input.signedAt);

  return Buffer.from(await pdf.save());
}
