import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import { buildBoxLabelPdf } from "./boxLabelPdf.js";

test("the box label is a single 4x6 in page", async () => {
  const bytes = await buildBoxLabelPdf({
    orderNo: "BOM-100107",
    qrUrl: "https://example.test/p/7KQ2MX9P4HTR",
    parcelId: "7KQ2-MX9P-4HTR",
    destination: "New York, United States",
    pieces: "2",
    bookedOn: "04 Oct 2026",
    isPickup: true,
  });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.equal(width, 288);
  assert.equal(height, 432);
});

test("text the standard fonts cannot encode does not break the label", async () => {
  const bytes = await buildBoxLabelPdf({
    orderNo: "BOM-100108",
    qrUrl: "https://example.test/p/x",
    parcelId: "7KQ2-MX9P-4HTR",
    destination: "Zürich, Schweiz — 東京",
    pieces: null,
    bookedOn: "",
    isPickup: false,
  });
  assert.ok(bytes.length > 500);
});
