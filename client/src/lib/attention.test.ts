import { test } from "node:test";
import assert from "node:assert/strict";
import { attentionItems, ATTENTION_LIMIT } from "./attention.js";
import type { DisplayRow } from "./shipmentRows.js";

function order(no: string, facts: Partial<NonNullable<DisplayRow["order"]>>, updatedAt = "2026-10-05T10:00:00Z"): DisplayRow {
  return {
    key: `order-${no}`,
    displayId: no,
    isOrder: true,
    recipient: "R",
    city: "",
    country: "",
    service: "",
    bookingDate: null,
    amountStr: null,
    statusLabel: "",
    statusTone: "gray",
    createdAt: updatedAt,
    updatedAt,
    isLive: true,
    awb: null,
    order: {
      status: "pickup_requested",
      pickupRequest: 1,
      pickupDate: null,
      paymentMethod: "pay_at_pickup",
      paymentStatus: "pending",
      amountDue: 1000,
      ...facts,
    },
  };
}

test("an OTP is due where the order page shows one", () => {
  const items = attentionItems(
    [
      order("BOM-100001", { status: "agent_accepted" }),
      order("BOM-100002", { status: "awaiting_dropoff", pickupRequest: 2 }),
      order("BOM-100003", { status: "picked_up" }),
      order("BOM-100004", { status: "awaiting_dropoff", pickupRequest: 1 }),
    ],
    []
  );
  assert.deepEqual(
    items.map((i) => (i.kind === "otp" ? `${i.orderNo}:${i.handover}` : i.kind)),
    ["BOM-100001:pickup", "BOM-100002:dropoff"]
  );
});

test("agent on the way outranks a payment, which outranks a later pickup", () => {
  const items = attentionItems(
    [
      order("BOM-100001", { status: "agent_accepted" }),
      order("BOM-100002", { status: "pickup_requested", paymentMethod: "pay_now", amountDue: 1240 }),
      order("BOM-100003", { status: "out_for_pickup" }),
    ],
    []
  );
  assert.deepEqual(items.map((i) => i.key), ["otp-order-BOM-100003", "pay-order-BOM-100002", "otp-order-BOM-100001"]);
  const pay = items[1];
  assert.equal(pay.kind === "pay" && pay.amount, 1240);
});

test("payment only for pay-now orders still pending and not cancelled", () => {
  const items = attentionItems(
    [
      order("BOM-100001", { paymentMethod: "pay_now", paymentStatus: "paid" }),
      order("BOM-100002", { paymentMethod: "pay_now", status: "cancelled" }),
      order("BOM-100003", { paymentMethod: "pay_now", paymentStatus: "partially_paid" }),
      order("BOM-100004", { paymentMethod: "pay_at_pickup" }),
    ],
    []
  );
  assert.equal(items.length, 0);
});

test("unread declined cancellations and application fixes; read ones and plain news are left to the bell", () => {
  const bell = [
    { id: "a", type: "order_status", title: "Cancellation declined", body: "", data: { cancellation: "rejected", order_no: "BOM-100001" }, is_read: false, created_at: "2026-10-05T09:00:00Z" },
    { id: "b", type: "account", title: "Your application needs a change", body: "", data: { application_id: "x" }, is_read: false, created_at: "2026-10-05T09:00:00Z" },
    { id: "c", type: "order_status", title: "Cancellation declined", body: "", data: { cancellation: "rejected", order_no: "BOM-100001" }, is_read: true, created_at: "2026-10-05T09:00:00Z" },
    { id: "d", type: "order_status", title: "Picked up", body: "", data: { order_no: "BOM-100001" }, is_read: false, created_at: "2026-10-05T09:00:00Z" },
  ];
  const items = attentionItems([], bell);
  assert.deepEqual(items.map((i) => i.kind === "notice" && i.notificationId), ["a", "b"]);
  assert.equal(items[0].kind === "notice" && items[0].href, "/order/BOM-100001");
  assert.equal(items[1].kind === "notice" && items[1].href, "/application/fix");
});

test("capped, and plain shipments never appear", () => {
  const rows = Array.from({ length: 6 }, (_, i) => order(`BOM-10000${i}`, { status: "agent_accepted" }));
  const shipment: DisplayRow = { ...order("1234567890", {}), isOrder: false, order: undefined };
  assert.equal(attentionItems([...rows, shipment], []).length, ATTENTION_LIMIT);
  assert.equal(attentionItems([shipment], []).length, 0);
});
