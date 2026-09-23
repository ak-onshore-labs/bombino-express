import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeFixBody } from "./applicationFix.js";
import type { ApplicationRow } from "./accountApplicationsDb.js";

function app(overrides: Partial<ApplicationRow> = {}): ApplicationRow {
  return {
    id: "app-1",
    phone: "9000000030",
    signup_ref: "ref-1",
    account_type: "company",
    company_category: "ecommerce",
    details: {
      email: "old@example.com",
      company_name: "Old Exports",
      gstin: "27AAPFU0939F1ZV",
      contact_person: "Priya",
      address: "1 Road",
      pincode: "400069",
      city: "Mumbai",
      state: "Maharashtra",
      hub_id: 1,
      lut_no: "AD270324000123X",
      iec_branch_code: null,
      bank_account_no: null,
      bank_ad_code: null,
    },
    contract_signed_name: "Priya Sharma",
    contract_version: "v1",
    contract_accepted_at: "2026-09-23T09:57:28.658Z",
    contract_accepted_ip: null,
    status: "changes_requested",
    requested_changes: { fields: ["email"], slots: ["aadhaar_card"], note: "" },
    ...overrides,
  } as ApplicationRow;
}

test("only the fields the team asked about come from the request", () => {
  const merged = mergeFixBody(app(), {
    email: "new@example.com",
    company_name: "Sneaky Rename Ltd",
    gstin: "29ABCDE1234F1Z5",
  });
  assert.equal(merged.email, "new@example.com");
  assert.equal(merged.company_name, "Old Exports");
  assert.equal(merged.gstin, "27AAPFU0939F1ZV");
});

test("phone, category and the signed contract are the filed ones", () => {
  const merged = mergeFixBody(app(), {
    phone: "9000000099",
    company_category: "corporate",
    contract_signed_name: "Someone Else",
  });
  assert.equal(merged.phone, "9000000030");
  assert.equal(merged.company_category, "ecommerce");
  assert.equal(merged.contract_signed_name, "Priya Sharma");
  assert.equal(merged.contract_accepted, true);
});

test("fields filed as null are left out, so the signup schema reads them as not given", () => {
  const merged = mergeFixBody(app(), {});
  assert.equal("iec_branch_code" in merged, false);
  assert.equal(merged.lut_no, "AD270324000123X");
});

test("an asked field missing from the request keeps its filed value", () => {
  const merged = mergeFixBody(app(), {});
  assert.equal(merged.email, "old@example.com");
});
