/**
 * The box label for a guest order: a 4×6 in sticker with a QR.
 *
 * A guest order has no AWB until ops dockets it at the hub, so there is no ITD
 * label to print. This one carries the order number and a QR that opens the
 * parcel's view-only page (`parcelTag.ts`). Nothing personal goes on it — no
 * names, phones or street addresses — because it rides on the outside of a box
 * through streets, vans and a hub: destination city and piece count are enough
 * to sort by.
 *
 * 4×6 in is the thermal-label size counters already use; on A4 it prints as a
 * cut-out panel. The QR is drawn as vector squares, so it scans cleanly at any
 * print scale.
 */

import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface BoxLabelInput {
  orderNo: string;
  /** Absolute URL the QR opens. Ends in the parcel ID. */
  qrUrl: string;
  /** The 12-character parcel ID the QR carries, printed under it, grouped. */
  parcelId: string;
  /** "New York, United States". */
  destination: string;
  pieces: string | null;
  /** "04 Oct 2026". */
  bookedOn: string;
  isPickup: boolean;
}

const W = 288; // 4 in
const H = 432; // 6 in
const M = 18;
const INK = rgb(0.07, 0.14, 0.19);
const MUTED = rgb(0.39, 0.45, 0.55);

/** The standard fonts are WinAnsi only; anything else would throw. */
function safe(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, "").trim();
}

function fitSize(font: PDFFont, text: string, max: number, maxWidth: number): number {
  let size = max;
  while (size > 8 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

function centred(page: PDFPage, text: string, font: PDFFont, size: number, y: number): void {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (W - w) / 2, y, size, font, color: INK });
}

export async function buildBoxLabelPdf(input: BoxLabelInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Bombino box label ${input.orderNo}`);
  const page = pdf.addPage([W, H]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Cut line, so an A4 print has an edge to follow.
  page.drawRectangle({
    x: 4,
    y: 4,
    width: W - 8,
    height: H - 8,
    borderColor: MUTED,
    borderWidth: 0.75,
    borderDashArray: [4, 3],
  });

  // Header
  page.drawText("BOMBINO EXPRESS", { x: M, y: H - M - 14, size: 13, font: bold, color: INK });
  const kind = input.isPickup ? "PICKUP" : "DROP-OFF";
  const kw = bold.widthOfTextAtSize(kind, 9);
  page.drawText(kind, { x: W - M - kw, y: H - M - 12, size: 9, font: bold, color: MUTED });
  page.drawLine({
    start: { x: M, y: H - M - 24 },
    end: { x: W - M, y: H - M - 24 },
    thickness: 1.25,
    color: INK,
  });

  // Order number, the thing a person reads first.
  page.drawText("ORDER", { x: M, y: H - M - 42, size: 8, font: bold, color: MUTED });
  const orderNo = safe(input.orderNo);
  const noSize = fitSize(bold, orderNo, 30, W - 2 * M);
  page.drawText(orderNo, { x: M, y: H - M - 70, size: noSize, font: bold, color: INK });

  // QR
  const qr = QRCode.create(input.qrUrl, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const quiet = 2;
  const qrSide = 168;
  const cell = qrSide / (count + quiet * 2);
  const qrX = (W - qrSide) / 2;
  const qrTop = H - M - 84;
  // Each row's dark run is one rectangle, nudged to overlap the next row:
  // module-sized squares leave hairline seams in some viewers and printers,
  // and a seam through a finder pattern is what makes a scanner give up.
  const bleed = 0.35;
  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (!qr.modules.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < count && qr.modules.get(row, col)) col++;
      page.drawRectangle({
        x: qrX + (start + quiet) * cell,
        y: qrTop - (row + quiet + 1) * cell - bleed,
        width: (col - start) * cell,
        height: cell + bleed,
        color: INK,
      });
    }
  }
  // The QR's own ID, right under it: what to type when a QR will not scan.
  centred(page, "PARCEL ID", bold, 7, qrTop - qrSide - 8);
  const parcelId = safe(input.parcelId);
  centred(page, parcelId, bold, fitSize(bold, parcelId, 20, W - 2 * M), qrTop - qrSide - 28);

  // Where it is going, and how many boxes make the set.
  const baseY = 92;
  page.drawLine({ start: { x: M, y: baseY + 30 }, end: { x: W - M, y: baseY + 30 }, thickness: 0.75, color: MUTED });
  page.drawText("TO", { x: M, y: baseY + 14, size: 8, font: bold, color: MUTED });
  const dest = safe(input.destination) || "-";
  page.drawText(dest, { x: M, y: baseY - 4, size: fitSize(bold, dest, 16, W - 2 * M), font: bold, color: INK });

  page.drawText("PIECES", { x: M, y: baseY - 30, size: 8, font: bold, color: MUTED });
  page.drawText(safe(input.pieces ?? "") || "1", { x: M, y: baseY - 48, size: 16, font: bold, color: INK });
  page.drawText("BOOKED", { x: W / 2, y: baseY - 30, size: 8, font: bold, color: MUTED });
  page.drawText(safe(input.bookedOn) || "-", { x: W / 2, y: baseY - 48, size: 12, font: regular, color: INK });

  centred(page, "Stick this on the largest face of the box.", regular, 7.5, 14);

  return pdf.save();
}
