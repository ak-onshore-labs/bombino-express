import { test } from "node:test";
import assert from "node:assert/strict";
import { caseReplySeed, notificationLink } from "./notificationLink.js";

test("a case reply opens BIA on that case; a shipment update opens its tracking", () => {
  assert.deepEqual(notificationLink({ kind: "support_case", caseNo: "BIA-1002", caseId: "x" }), { kind: "case", caseNo: "BIA-1002" });
  assert.deepEqual(notificationLink({ awb: "1234567890" }), { kind: "shipment", awb: "1234567890" });
  assert.match(caseReplySeed("BIA-1002"), /BIA-1002/);
});

test("anything else leads nowhere", () => {
  assert.equal(notificationLink(null), null);
  assert.equal(notificationLink("BIA-1002"), null);
  assert.equal(notificationLink({ kind: "support_case", caseNo: "BIA-12; drop" }), null);
  assert.equal(notificationLink({ kind: "support_case" }), null);
  assert.equal(notificationLink({ awb: "" }), null);
});
