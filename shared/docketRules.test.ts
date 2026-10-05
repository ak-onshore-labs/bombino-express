import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyDocketFailure, docketProblems } from "./docketRules.js";
import { explainDocketError } from "./docketError.js";

const GOOD = {
  product_code: "SPX",
  destination_code: "US",
  api_service_code: "BEXP",
  shipper_name: "A",
  shipper_contact_no: "9800000000",
  shipper_address_line_1: "1 Road",
  shipper_city: "Mumbai",
  shipper_zip_code: "400001",
  consignee_name: "B",
  consignee_contact_no: "2125550100",
  consignee_address_line_1: "5 Ave",
  consignee_city: "New York",
  consignee_country: "US",
  consignee_state: "NY",
  consignee_zip_code: "10001",
  shipment_content: "Clothes",
  actual_weight: "2",
  docket_items: [{ actual_weight: "2", length: "10", width: "10", height: "10", number_of_boxes: "1" }],
};

test("a complete booking has no problems", () => {
  assert.deepEqual(docketProblems(GOOD), []);
});

test("the refusals ITD has actually given are caught before filing", () => {
  assert.deepEqual(docketProblems({ ...GOOD, consignee_zip_code: "1001" }), ['US ZIP "1001" must be 5 digits']);
  assert.deepEqual(docketProblems({ ...GOOD, consignee_state: "" }), ["US state is missing"]);
  assert.deepEqual(docketProblems({ ...GOOD, consignee_state: "Bombay" }), ['"Bombay" is not a US state']);
  assert.match(docketProblems({ ...GOOD, product_code: "DOX", shipment_content: "Books" })[0] ?? "", /Package \(SPX\)/);
  assert.deepEqual(docketProblems({ ...GOOD, product_code: "DOX", shipment_content: "Documents" }), []);
});

test("missing fields and weight are named", () => {
  const p = docketProblems({ ...GOOD, consignee_name: " ", actual_weight: "0", docket_items: [] });
  assert.deepEqual(p, ["Receiver name is missing", "Weight must be more than 0 kg", "Box details are missing"]);
  assert.deepEqual(docketProblems(null), ["Booking details are missing from the order"]);
});

test("a postal code is only required for the US", () => {
  const qatar = { ...GOOD, destination_code: "QA", consignee_country: "QA", consignee_state: "", consignee_zip_code: "" };
  assert.deepEqual(docketProblems(qatar), []);
  assert.deepEqual(docketProblems({ ...GOOD, consignee_zip_code: "" }), ["US ZIP is missing"]);
});

test("only failures that never reached ITD are retried automatically", () => {
  assert.equal(classifyDocketFailure('ITD create shipment error: 500 — {"errors":"AUTH TOKEN EXPIRED. PLEASE GENERATE NEW AUTH TOKEN"}').retry, "auto");
  assert.equal(classifyDocketFailure("connect ECONNREFUSED 1.2.3.4:443").retry, "auto");
  assert.equal(classifyDocketFailure("getaddrinfo ENOTFOUND admin.bombinoexp.com").retry, "auto");
});

test("anything ITD may have processed waits for a person to check ITD", () => {
  for (const m of [
    "ITD create_docket timed out after 15000ms",
    "read ECONNRESET",
    "fetch failed",
    "ITD create shipment error: 504 Gateway Timeout — <html>",
    "something nobody has seen before",
  ]) {
    assert.equal(classifyDocketFailure(m).retry, "check_itd", m);
  }
});

test("an outright ITD refusal goes back to ops to correct", () => {
  const f = classifyDocketFailure('ITD create shipment error: 500 Internal Server Error — {"success":false,"errors":["Freight amount is 0"]}');
  assert.deepEqual(f, { stage: "create_docket", retry: "ops" });
});

test("ops is never told a timeout is safe to refile", () => {
  const hint = explainDocketError("ITD did not answer within 15 seconds.", "timeout", "check_itd").opsHint;
  assert.doesNotMatch(hint, /safe/i);
  assert.match(hint, /ITD account/);
  assert.match(explainDocketError("connect ECONNREFUSED", "network", "auto").opsHint, /automatically/);
});
