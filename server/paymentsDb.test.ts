import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePaymentStatus } from "./paymentsDb.js";

const base = { status: "weighed", paymentMethod: "pay_now", isCod: false, current: "pending" };

test("covered, short, over and nothing held", () => {
  assert.equal(derivePaymentStatus({ ...base, due: 1000, held: 1000 }), "paid");
  assert.equal(derivePaymentStatus({ ...base, due: 1000, held: 1 }), "partially_paid", "₹1 of ₹1000 is not paid");
  assert.equal(derivePaymentStatus({ ...base, due: 1000, held: 400 + 600 }), "paid", "two partials add up");
  assert.equal(derivePaymentStatus({ ...base, due: 1250, held: 50000 }), "refund_due", "weighed lighter");
  assert.equal(derivePaymentStatus({ ...base, due: 1000, held: 100 }), "partially_paid", "weighed heavier");
  assert.equal(derivePaymentStatus({ ...base, due: 1000, held: 0 }), "pending");
});

test("paisa rounding is not a refund or a shortfall", () => {
  assert.equal(derivePaymentStatus({ ...base, due: 1234.56, held: 1234.56 }), "paid");
  assert.equal(derivePaymentStatus({ ...base, due: 1234.565, held: 1234.56 }), "paid");
});

test("COD is never touched; a cancelled order holding money owes it back", () => {
  assert.equal(derivePaymentStatus({ ...base, paymentMethod: "cod", isCod: true, due: 1000, held: 0 }), null);
  assert.equal(derivePaymentStatus({ ...base, status: "cancelled", due: 600, held: 600 }), "refund_due");
  assert.equal(derivePaymentStatus({ ...base, status: "cancelled", due: 600, held: 0 }), null);
});

test("a failed gateway attempt with nothing held keeps saying failed", () => {
  assert.equal(derivePaymentStatus({ ...base, current: "failed", due: 1000, held: 0 }), null);
});

test("no amount due on record: anything collected covers it", () => {
  assert.equal(derivePaymentStatus({ ...base, due: null, held: 10 }), "paid");
});
