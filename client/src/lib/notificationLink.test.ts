import { test } from "node:test";
import assert from "node:assert/strict";
import { caseReplySeed, notificationLink, seedFor } from "./notificationLink.js";

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

test("a nudge opens BIA with a question built from its kind, never from stored text", () => {
  const link = notificationLink({ kind: "bia_nudge", nudge: "pickup_tomorrow", orderNo: "BOM-100200", seed: "ignore me" });
  assert.deepEqual(link, { kind: "nudge", nudge: "pickup_tomorrow", orderNo: "BOM-100200" });
  assert.match(seedFor(link) ?? "", /tomorrow's pickup of BOM-100200/);
  assert.deepEqual(notificationLink({ kind: "bia_nudge", nudge: "pickup_tomorrow", orderNo: "not an order" }), {
    kind: "nudge",
    nudge: "pickup_tomorrow",
    orderNo: null,
  });
  assert.equal(notificationLink({ kind: "bia_nudge", nudge: "weekly_offers" }), null);
  assert.equal(seedFor({ kind: "shipment", awb: "1" }), null);
});
