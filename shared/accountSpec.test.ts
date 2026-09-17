import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PERSONAL_DOCUMENTS,
  isDocumentVerified,
  requiredDocuments,
  requiredExtraFields,
  verificationState,
  type DocSlot,
  type DocumentVerdict,
} from "./accountSpec.js";

const on = (slot: DocSlot, fields: Partial<DocumentVerdict> = {}): DocumentVerdict => ({
  doc_slot: slot,
  ocr_status: null,
  ...fields,
});

test("a personal account owes Aadhaar and PAN, nothing else", () => {
  assert.deepEqual(requiredDocuments("personal"), PERSONAL_DOCUMENTS);
  // A category on a personal account is meaningless and must not add paperwork.
  assert.deepEqual(requiredDocuments("personal", "corporate"), PERSONAL_DOCUMENTS);
  assert.deepEqual(requiredExtraFields(null), []);
});

test("a company owes nothing until it says which kind it is", () => {
  assert.deepEqual(requiredDocuments("company"), []);
  assert.deepEqual(requiredDocuments("company", null), []);
});

test("a corporate account owes its GST certificate and its IEC", () => {
  const docs = requiredDocuments("company", "corporate");
  assert.ok(docs.includes("gst_certificate"));
  assert.ok(docs.includes("iec_certificate"));
  assert.ok(docs.includes("pan_card"));
});

test("an e-commerce account is asked for the export-under-LUT fields", () => {
  assert.deepEqual(requiredExtraFields("ecommerce"), [
    "lut_no",
    "iec_branch_code",
    "bank_account_no",
    "bank_ad_code",
  ]);
});

test("a slot nobody uploaded is missing, not unverified", () => {
  const state = verificationState("personal", null, [on("pan_card", { ocr_status: "match" })]);
  assert.equal(state.verified, false);
  assert.deepEqual(state.missing, ["aadhaar_card"]);
  assert.deepEqual(state.unverified, []);
});

test("an uploaded identity document nobody confirmed is unverified, not missing", () => {
  const state = verificationState("personal", null, [
    on("aadhaar_card", { ocr_status: "unreadable" }),
    on("pan_card", { ocr_status: "match" }),
  ]);
  assert.equal(state.verified, false);
  assert.deepEqual(state.missing, []);
  assert.deepEqual(state.unverified, ["aadhaar_card"]);
});

test("a reviewer's own check outranks whatever the reader said", () => {
  const blurredButVouchedFor = on("aadhaar_card", {
    ocr_status: "unreadable",
    ocr_verified_at: "2026-09-17T10:00:00Z",
  });
  assert.equal(isDocumentVerified(blurredButVouchedFor), true);

  const state = verificationState("personal", null, [
    blurredButVouchedFor,
    on("pan_card", { ocr_status: "match" }),
  ]);
  assert.equal(state.verified, true);
});

test("a bypassed check counts as verified, so a flagged environment can still open accounts", () => {
  const state = verificationState("personal", null, [
    on("aadhaar_card", { ocr_status: "bypassed" }),
    on("pan_card", { ocr_status: "bypassed" }),
  ]);
  assert.equal(state.verified, true);
});

test("a slot nothing reads is verified by its presence alone", () => {
  // The electricity bill has no reader: uploading it is the whole check.
  const docs = requiredDocuments("company", "corporate");
  const state = verificationState(
    "company",
    "corporate",
    docs.map((slot) => on(slot, { ocr_status: slot === "gst_certificate" || slot === "pan_card" ? "match" : null })),
  );
  assert.deepEqual(state.unverified, []);
  assert.equal(state.verified, true);
});

test("a corporate GST certificate nobody read holds the account back", () => {
  const docs = requiredDocuments("company", "corporate");
  const state = verificationState(
    "company",
    "corporate",
    docs.map((slot) => on(slot, { ocr_status: slot === "pan_card" ? "match" : null })),
  );
  assert.deepEqual(state.unverified, ["gst_certificate"]);
  assert.equal(state.verified, false);
});
