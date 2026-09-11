import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAssistantMessage } from "./supportMessage.js";

// A reply exactly as BIA 2.0 stored it, before cards existed.
const STORED_2_0 = [
  "Your order BOM-100136 is awaiting drop-off.",
  "",
  "TAP_LOCATIONS:Maharashtra",
  "TAP_MY_ORDERS",
  "TAP_VIEW_ORDER:BOM-100108",
  "TAP_TRACK:AB12CD34",
  "TAP_CONTACT_US",
].join("\n");

test("an old transcript still gets its buttons back", () => {
  const { text, ctas } = parseAssistantMessage(STORED_2_0);
  assert.equal(text, "Your order BOM-100136 is awaiting drop-off.");
  assert.deepEqual(ctas, [
    { kind: "locations", state: "Maharashtra" },
    { kind: "my_orders" },
    { kind: "view_order", orderNo: "BOM-100108" },
    { kind: "track", awb: "AB12CD34" },
    { kind: "contact_us" },
  ]);
});

test("a multi-word state decodes for the button", () => {
  assert.deepEqual(parseAssistantMessage("x\nTAP_LOCATIONS:Tamil%20Nadu").ctas, [
    { kind: "locations", state: "Tamil Nadu" },
  ]);
});

test("unknown or malformed tokens are left out, and duplicates collapse", () => {
  const { ctas } = parseAssistantMessage("x\nTAP_BOGUS\nTAP_VIEW_ORDER:nope\nTAP_MY_ORDERS\nTAP_MY_ORDERS");
  assert.deepEqual(ctas, [{ kind: "my_orders" }]);
});
