import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeRateRow } from "./itdRates";

test("GST rate is worked out when ITD sends only the amounts (BMS PRINTED MATERIAL)", () => {
  const row = normalizeRateRow({
    id: "1", code: "BMS PRINTED MATERIAL", rate: 368, fsc: 0, other_charges: 0,
    cgst: 33.12, sgst: 33.12, igst: "", total: 434.24, weight: 0,
  })!;
  assert.equal(row.gst_total, 66.24);
  assert.equal(row.gst_per, "18");
});

test("IGST counts as GST, not just CGST + SGST", () => {
  const row = normalizeRateRow({
    id: "2", code: "INTERSTATE", rate: 1000, fsc: 100, other_charges: 0,
    cgst: 0, sgst: 0, igst: 198, total: 1298, weight: "2",
  })!;
  assert.equal(row.gst_total, 198);
  assert.equal(row.gst_per, "18");
});

test("ITD's weight 0 is read as 'not worked out', a real one is kept", () => {
  assert.equal(normalizeRateRow({ id: "3", code: "A", weight: 0 })!.weight, "");
  assert.equal(normalizeRateRow({ id: "4", code: "B", weight: "1.5" })!.weight, "1.5");
});

test("a GST rate ITD does send is used as it is", () => {
  const row = normalizeRateRow({ id: "5", code: "C", rate: 100, cgst: 9, sgst: 9, total: 118, gst_per: "18" })!;
  assert.equal(row.gst_per, "18");
});
