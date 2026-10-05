import { test } from "node:test";
import assert from "node:assert/strict";
import { hrefFor, noticeFields, notificationCategory, notificationLink, notificationTarget, notificationTone, seedFor } from "./notificationLink.js";

test("a shipment update opens its tracking", () => {
  assert.deepEqual(notificationLink({ awb: "1234567890" }), { kind: "shipment", awb: "1234567890" });
});

test("anything else leads nowhere", () => {
  assert.equal(notificationLink(null), null);
  assert.equal(notificationLink("BIA-1002"), null);
  assert.equal(notificationLink({ kind: "support_case", caseNo: "BIA-1002" }), null);
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

test("an order status row opens the order page", () => {
  const link = notificationLink({ order_id: "x", order_no: "BOM-100200", status: "picked_up" });
  assert.deepEqual(link, { kind: "order", orderNo: "BOM-100200" });
  assert.equal(hrefFor(link), "/order/BOM-100200");
  assert.equal(notificationLink({ order_no: "not an order" }), null);
});

test("a handover code row opens the code on the order page, and never carries the code", () => {
  const link = notificationLink({ kind: "handover_code", handover: "dropoff", order_no: "BOM-100200" });
  assert.deepEqual(link, { kind: "code", orderNo: "BOM-100200", handover: "dropoff" });
  assert.equal(hrefFor(link), "/order/BOM-100200#handover-code");
});

test("rows are shelved by type, with data.kind covering the order_status fallback", () => {
  const code = { type: "order_status", data: { kind: "handover_code", order_no: "BOM-100200" } };
  assert.equal(notificationCategory(code), "otps");
  assert.equal(notificationCategory({ type: "handover_code", data: null }), "otps");
  assert.equal(notificationCategory({ type: "order_status", data: { kind: "bia_nudge", nudge: "pickup_tomorrow" } }), "tips");
  assert.equal(notificationCategory({ type: "account", data: {} }), "account");
  assert.equal(notificationCategory({ type: "order_status", data: { order_no: "BOM-100200" } }), "shipments");
  assert.equal(notificationCategory({ type: "shipment_created", data: { awb: "1" } }), "shipments");
  assert.equal(notificationCategory({ type: null, data: null }), "shipments");
});

test("tone flags trouble and finished shipments", () => {
  assert.equal(notificationTone({ type: "order_status", title: "Cancellation declined", data: { cancellation: "rejected" } }), "warning");
  assert.equal(notificationTone({ type: "order_status", title: "Cancelled", data: { status: "cancelled" } }), "warning");
  assert.equal(notificationTone({ type: "order_status", title: "Dispatched", data: { status: "dispatched" } }), "success");
  assert.equal(notificationTone({ type: "order_status", title: "Picked up", data: { status: "picked_up" } }), "progress");
  assert.equal(notificationTone({ type: "account", title: "Your account is ready", data: {} }), "success");
  assert.equal(notificationTone({ type: "account", title: "Your application needs a change", data: {} }), "warning");
});

test("an order row with an AWB still opens the order, which shows both", () => {
  assert.deepEqual(notificationLink({ order_no: "BOM-100200", awb: "1234567890" }), { kind: "order", orderNo: "BOM-100200" });
});

test("the card's fields come out of data, and the body loses what they now show", () => {
  const order = noticeFields({
    body: "BOM-100200 — your parcel has reached the hub.",
    data: { order_no: "BOM-100200", awb: "1234567890", destination: "New York, United States" },
  });
  assert.deepEqual(order, {
    orderNo: "BOM-100200",
    awb: "1234567890",
    destination: "New York, United States",
    message: "Your parcel has reached the hub.",
  });

  const booked = noticeFields({ body: "Your shipment has been booked. AWB: 1234567890", data: { awb: "1234567890" } });
  assert.equal(booked.message, "Your shipment has been booked.");
  assert.equal(booked.orderNo, null);

  const bare = noticeFields({ body: null, data: null });
  assert.deepEqual(bare, { orderNo: null, awb: null, destination: null, message: "" });
});

test("account rows lead to the screen they are about", () => {
  const to = (title: string, data: Record<string, unknown> = {}) =>
    hrefFor(notificationTarget({ type: "account", title, data }));
  assert.equal(to("Mobile number linked", { phone: "+919800000000" }), "/profile#phone");
  assert.equal(to("Mobile number changed"), "/profile#phone");
  assert.equal(to("Your application needs a change", { application_id: "a" }), "/application/fix");
  assert.equal(to("Your account is ready", { application_id: "a" }), "/orders");
  assert.equal(to("Application received", { application_id: "a" }), "/guest-profile");
  assert.equal(to("Account not opened", { application_id: "a" }), "/guest-profile");
  // Anything else on an account row still goes somewhere.
  assert.equal(to("Something new"), "/profile");
});

test("non-account rows are unchanged by the target lookup", () => {
  assert.deepEqual(notificationTarget({ type: "order_status", title: "Picked up", data: { order_no: "BOM-100200" } }), {
    kind: "order",
    orderNo: "BOM-100200",
  });
});
