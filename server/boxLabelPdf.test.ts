import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import { buildBoxLabelPdf } from "./boxLabelPdf.js";

test("the box label is a single 4x6 in page", async () => {
  const bytes = await buildBoxLabelPdf({
    orderNo: "BOM-100107",
    qrUrl: "https://example.test/p/7KQ2MX9P4HTR",
    parcelId: "7KQ2-MX9P-4HTR",
    consignee: { name: "Arbaaz Khan", company: null, address: ["2B-1404, Rajyog CHS"], cityLine: "Adrian, TX 79001", country: "United States", phone: "9198332075" },
    shipper: { name: "Aditya K", company: "Onshore Labs", address: ["801, Balaji Aura, Sector 23"], cityLine: "Raigarh, Maharashtra 410208", country: "India", phone: "9175583728" },
    service: "BMS DDP LITE",
    weightKg: 2,
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
    consignee: { name: "Zoë — 東京", company: null, address: ["Bahnhofstraße 1"], cityLine: "Zürich", country: "Schweiz", phone: null },
    shipper: { name: null, company: null, address: [], cityLine: null, country: null, phone: null },
    service: null,
    weightKg: null,
    pieces: null,
    bookedOn: "",
    isPickup: false,
  });
  assert.ok(bytes.length > 500);
});
