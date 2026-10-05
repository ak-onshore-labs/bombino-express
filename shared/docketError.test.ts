import { test } from "node:test";
import assert from "node:assert/strict";

import { explainDocketError, itdReason } from "./docketError.js";

const BOM_100305 =
  'ITD create shipment error: 500 Internal Server Error — {"success":false,"errors":["Freight amount is 0"],"Response Code":500}';

test("ITD's own reason comes out of the HTTP wrapping", () => {
  assert.equal(itdReason(BOM_100305), "Freight amount is 0");
  assert.equal(itdReason("ITD create shipment error: 422 Unprocessable — bad zip"), "bad zip");
  assert.equal(itdReason("Could not sign in to ITD to issue an airway bill."), "Could not sign in to ITD to issue an airway bill.");
});

test("a zero freight explains the address and product type", () => {
  const f = explainDocketError(BOM_100305, "create_docket");
  assert.match(f.reason, /couldn't price/);
  assert.match(f.opsHint, /5-digit ZIP/);
  assert.match(f.opsHint, /DOX/);
  // Ours to fix with the customer, not something to show them.
  assert.equal(f.customerNote, null);
});

test("the stage decides the advice when ITD's words don't", () => {
  assert.match(explainDocketError("Could not sign in to ITD to issue an airway bill.", "token").opsHint, /password/);
  assert.match(explainDocketError("No identity document on file.", "kyc").customerNote ?? "", /ID document/);
});

test("the customer hears nothing unless there is something for them to do", () => {
  for (const raw of [
    "ITD create_docket (booking) timed out after 15000ms",
    'ITD create shipment error: 500 Internal Server Error — {"success":false,"errors":"AUTH TOKEN EXPIRED","Response Code":500}',
    "Could not sign in to ITD to issue an airway bill.",
    "ITD issued AWB 123 but it could not be saved against this order.",
  ]) {
    assert.equal(explainDocketError(raw).customerNote, null, raw);
  }
  assert.doesNotMatch(explainDocketError("No identity document on file.", "kyc").customerNote ?? "", /ITD|airway|docket/i);
});
