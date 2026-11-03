import { test } from "node:test";
import assert from "node:assert/strict";

import { isReceiverOf, toReceivingEvents, toReceivingParcel, type ReceivingRow } from "./receivingDb.js";
import { normalizeReceiverAppPhone, receiverAppPhoneOf, suggestedReceiverAppPhone } from "../shared/receiving.js";

const RECEIVER = "9876543210";

function row(overrides: Partial<ReceivingRow> = {}): ReceivingRow {
  return {
    id: "o1",
    order_no: "BOM-100400",
    user_id: null,
    guest_phone: "9123456780",
    guest_name: "Aditya Kamarouthu",
    status: "pickup_requested",
    consignee: { name: "Arbaaz Khan", phone: "2125550100", country_code: "US", city: "New York", country_name: "United States", app_phone: RECEIVER },
    items: { api_service_code: "EXPRESS" },
    awb_no: null,
    metadata: {},
    created_at: "2026-10-15T10:00:00Z",
    updated_at: "2026-10-15T11:00:00Z",
    origin_address: { full_name: "Aditya Kamarouthu", city: "Mumbai" },
    ...overrides,
  };
}

const viewer = { phone: RECEIVER, userId: null };

test("the app number the sender gave matches", () => {
  assert.equal(isReceiverOf(row(), viewer), true);
});

test("a receiver phone written with +91 matches on an older booking", () => {
  const consignee = { phone: "+919876543210", country_code: "US" };
  assert.equal(receiverAppPhoneOf(consignee), RECEIVER);
  assert.equal(receiverAppPhoneOf({ phone: "919876543210" }), RECEIVER);
});

test("ten digits on a parcel going to India match", () => {
  assert.equal(receiverAppPhoneOf({ phone: RECEIVER, country_code: "IN" }), RECEIVER);
});

test("bare ten digits to the US never match, even when they look Indian", () => {
  // 917 is a New York area code; 9175550100 is also a valid-looking Indian mobile.
  assert.equal(receiverAppPhoneOf({ phone: "9175550100", country_code: "US" }), null);
  assert.equal(
    isReceiverOf(row({ consignee: { phone: "9175550100", country_code: "US" } }), { phone: "9175550100", userId: null }),
    false
  );
});

test("someone else's number does not match", () => {
  assert.equal(isReceiverOf(row(), { phone: "9000000001", userId: null }), false);
});

test("cancelled parcels are hidden", () => {
  assert.equal(isReceiverOf(row({ status: "cancelled" }), viewer), false);
});

test("a parcel you sent yourself stays under Sending", () => {
  assert.equal(isReceiverOf(row({ guest_phone: RECEIVER }), viewer), false);
  assert.equal(isReceiverOf(row({ user_id: "u1", guest_phone: null }), { phone: RECEIVER, userId: "u1" }), false);
  assert.equal(isReceiverOf(row({ user_id: "u2", guest_phone: null }), { phone: RECEIVER, userId: "u1" }), true);
});

test("test orders are hidden from a real phone and shown to a test phone", () => {
  const testRow = row({ metadata: { test: true } });
  assert.equal(isReceiverOf(testRow, viewer), false);
  const testViewer = { phone: "7558372885", userId: null };
  assert.equal(
    isReceiverOf(row({ metadata: { test: true }, consignee: { app_phone: "7558372885" } }), testViewer),
    true
  );
});

test("the receiver's view carries no money, phones or addresses", () => {
  const parcel = toReceivingParcel(row({ consignee: { ...(row().consignee as object), address_line_1: "1 Main St" } }));
  const json = JSON.stringify(parcel);
  for (const secret of ["2125550100", "9123456780", RECEIVER, "1 Main St", "Kamarouthu", "Arbaaz"]) {
    assert.ok(!json.includes(secret), secret);
  }
  assert.equal(parcel.sender_first_name, "Aditya");
  assert.equal(parcel.sender_city, "Mumbai");
  assert.ok(!("quoted_amount" in parcel) && !("final_amount" in parcel));
});

test("the app number is stored as ten digits or not at all", () => {
  assert.equal(normalizeReceiverAppPhone("+91 98765 43210"), RECEIVER);
  assert.equal(normalizeReceiverAppPhone("2125550100"), null);
  assert.equal(normalizeReceiverAppPhone("12345"), null);
  assert.equal(normalizeReceiverAppPhone(""), null);
  assert.equal(normalizeReceiverAppPhone(42), null);
});

test("the form suggests an app number only when the receiver phone is clearly Indian", () => {
  assert.equal(suggestedReceiverAppPhone("919876543210", "US"), RECEIVER);
  assert.equal(suggestedReceiverAppPhone("9876543210", "US"), "");
});

test("history keeps each status once and drops notes", () => {
  const events = toReceivingEvents([
    { status: "pickup_requested", created_at: "1" },
    { status: "pickup_requested", created_at: "2" },
    { status: "picked_up", created_at: "3" },
  ]);
  assert.deepEqual(events.map((e) => e.status), ["pickup_requested", "picked_up"]);
});
