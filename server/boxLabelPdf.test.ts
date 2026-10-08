import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import { buildBoxLabelPdf } from "./boxLabelPdf.js";

test("the box label is a single 4x6 in page", async () => {
  const bytes = await buildBoxLabelPdf({
    orderNo: "BOM-100107",
    qrUrl: "https://example.test/p/3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.AAAAAAAAAAAAAAAAAAAAAA",
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
    destination: "Zürich, Schweiz — 東京",
    pieces: null,
    bookedOn: "",
    isPickup: false,
  });
  assert.ok(bytes.length > 500);
});
