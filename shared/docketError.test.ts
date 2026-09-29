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
  assert.doesNotMatch(f.customerNote, /ITD|500|Freight amount/);
});

test("the stage decides the advice when ITD's words don't", () => {
  assert.match(explainDocketError("Could not sign in to ITD to issue an airway bill.", "token").opsHint, /password/);
  assert.match(explainDocketError("No identity document on file.", "kyc").customerNote, /identity document/);
});
