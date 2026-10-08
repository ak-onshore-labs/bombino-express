/**
 * The box label for an order with no AWB yet: a 4×6 in shipping label.
 *
 * It carries what ITD's own box label carries, so the agent, the hub and the
 * courier can work from it: consignee and shipper (name, company, address,
 * phone), the carrier service, pieces and weight. On top of that, our QR and
 * the 12-character parcel ID printed under it, which open the order.
 *
 * 4×6 in is the thermal-label size counters already use; on A4 it prints as a
 * cut-out panel. The QR is drawn as vector squares, so it scans cleanly at any
 * print scale.
 */

import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface LabelParty {
  name: string | null;
  company: string | null;
  /** Street lines, already split. */
  address: (string | null | undefined)[];
  /** "Adrian, TX 79001" */
  cityLine: string | null;
  country: string | null;
  phone: string | null;
}

export interface BoxLabelInput {
  orderNo: string;
  /** Absolute URL the QR opens. Ends in the parcel ID. */
  qrUrl: string;
  /** The 12-character parcel ID the QR carries, printed under it, grouped. */
  parcelId: string;
  consignee: LabelParty;
  shipper: LabelParty;
  /** The carrier service booked, e.g. "BMS DDP LITE". */
  service: string | null;
  pieces: string | null;
  /** Booked weight, kg. */
  weightKg: number | null;
  /** "04 Oct 2026". */
  bookedOn: string;
  isPickup: boolean;
}

const W = 288; // 4 in
const H = 432; // 6 in
const M = 14;
const INK = rgb(0.07, 0.14, 0.19);
const MUTED = rgb(0.39, 0.45, 0.55);
const RULE = rgb(0.75, 0.78, 0.82);

/** The standard fonts are WinAnsi only; anything else would throw. */
function safe(text: string | null | undefined): string {
  return (text ?? "").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
}

function fitSize(font: PDFFont, text: string, max: number, maxWidth: number): number {
  let size = max;
  while (size > 6 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

/** Word-wrap `text` to `maxWidth`, at most `maxLines` lines (the last cut short). */
function wrap(font: PDFFont, text: string, size: number, maxWidth: number, maxLines: number): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = w;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && font.widthOfTextAtSize(`${last}...`, size) > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}...`;
  }
  return lines;
}

function hr(page: PDFPage, y: number, thickness = 0.75, color = RULE): void {
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness, color });
}

/** One party block. Returns the y below it. */
function partyBlock(
  page: PDFPage,
  title: string,
  party: LabelParty,
  top: number,
  regular: PDFFont,
  bold: PDFFont,
  maxLines: number
): number {
  let y = top;
  page.drawText(title, { x: M, y, size: 7.5, font: bold, color: MUTED });
  y -= 12;
  const width = W - 2 * M;
  const name = safe(party.name) || "-";
  page.drawText(name, { x: M, y, size: fitSize(bold, name, 11, width), font: bold, color: INK });
  y -= 12;
  const lines: string[] = [];
  const company = safe(party.company);
  if (company && company.toLowerCase() !== name.toLowerCase()) lines.push(company);
  const street = safe(party.address.filter(Boolean).join(", "));
  if (street) lines.push(...wrap(regular, street, 8.5, width, 2));
  const city = safe(party.cityLine);
  if (city) lines.push(city);
  const country = safe(party.country);
  if (country) lines.push(country.toUpperCase());
  for (const l of lines.slice(0, maxLines)) {
    page.drawText(l, { x: M, y, size: 8.5, font: regular, color: INK });
    y -= 10.5;
  }
  const phone = safe(party.phone);
  if (phone) {
    page.drawText(`TEL: ${phone}`, { x: M, y, size: 8.5, font: bold, color: INK });
    y -= 10.5;
  }
  return y;
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

  // ── Header ──
  let y = H - M - 10;
  page.drawText("BOMBINO EXPRESS", { x: M, y, size: 11, font: bold, color: INK });
  const kind = input.isPickup ? "PICKUP" : "DROP-OFF";
  page.drawText(kind, { x: W - M - bold.widthOfTextAtSize(kind, 8), y: y + 1, size: 8, font: bold, color: MUTED });
  y -= 7;
  hr(page, y, 1.25, INK);

  // ── Order number | carrier ──
  y -= 11;
  page.drawText("ORDER", { x: M, y, size: 7, font: bold, color: MUTED });
  page.drawText("CARRIER", { x: W / 2 + 6, y, size: 7, font: bold, color: MUTED });
  y -= 17;
  const orderNo = safe(input.orderNo);
  page.drawText(orderNo, { x: M, y, size: fitSize(bold, orderNo, 18, W / 2 - M), font: bold, color: INK });
  const service = safe(input.service) || "-";
  const serviceLines = wrap(bold, service, 9, W / 2 - M - 6, 2);
  serviceLines.forEach((l, i) =>
    page.drawText(l, { x: W / 2 + 6, y: y + 6 - i * 10, size: 9, font: bold, color: INK })
  );
  y -= 9;
  hr(page, y);

  // ── Consignee, then shipper ──
  y = partyBlock(page, "CONSIGNEE", input.consignee, y - 11, regular, bold, 5);
  y -= 2;
  hr(page, y);
  y = partyBlock(page, "SHIPPER", input.shipper, y - 11, regular, bold, 4);
  y -= 2;
  hr(page, y, 1.25, INK);

  // ── QR + parcel ID + pieces / weight / date ──
  const qrSide = Math.min(118, y - M - 18);
  const qrTop = y - 6;
  const qr = QRCode.create(input.qrUrl, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const quiet = 1;
  const cell = qrSide / (count + quiet * 2);
  const qrX = M - 2;
  // Each row's dark run is one rectangle, nudged to overlap the next row:
  // module-sized squares leave hairline seams in some viewers and printers.
  const bleed = 0.3;
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

  const rx = qrX + qrSide + 10;
  const rw = W - M - rx;
  let ry = qrTop - 10;
  page.drawText("PARCEL ID", { x: rx, y: ry, size: 7, font: bold, color: MUTED });
  ry -= 16;
  const parcelId = safe(input.parcelId);
  page.drawText(parcelId, { x: rx, y: ry, size: fitSize(bold, parcelId, 15, rw), font: bold, color: INK });
  ry -= 20;

  const facts: [string, string][] = [
    ["PIECES", safe(input.pieces) || "1"],
    ["WEIGHT", input.weightKg != null && Number.isFinite(input.weightKg) ? `${Number(input.weightKg.toFixed(2))} kg` : "-"],
    ["BOOKED", safe(input.bookedOn) || "-"],
  ];
  for (const [label, value] of facts) {
    page.drawText(label, { x: rx, y: ry, size: 7, font: bold, color: MUTED });
    page.drawText(value, { x: rx + 46, y: ry, size: 9, font: bold, color: INK });
    ry -= 14;
  }

  const foot = "Scan the QR or quote the parcel ID to track.";
  page.drawText(foot, { x: (W - regular.widthOfTextAtSize(foot, 7)) / 2, y: M - 2, size: 7, font: regular, color: MUTED });

  return pdf.save();
}
