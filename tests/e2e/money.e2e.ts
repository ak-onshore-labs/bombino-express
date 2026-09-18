/**
 * P0 money edge cases: reweigh reconciliation, cash collection, booking amounts,
 * the Razorpay webhook, and refunds on cancellation.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  Client,
  act,
  as,
  book,
  bookingBody,
  cleanup,
  drivePickup,
  makePickupToday,
  mustAct,
  reload,
  sb,
  signWebhook,
  startServer,
  stopServer,
} from "./harness.js";

before(() => startServer());
after(async () => {
  await cleanup();
  await stopServer();
});

async function testSettle(orderId: string) {
  const c = await as("customer");
  const r = await c.post("/api/payments/test/settle", { order_id: orderId });
  assert.equal(r.status, 200, `test settle: ${r.text}`);
}

async function paymentRows(orderId: string) {
  const { data } = await sb().from("payments").select("id, amount, method, reference").eq("order_id", orderId);
  return data ?? [];
}

function capturedEvent(orderId: string, paymentId: string, rupees: number) {
  return JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: paymentId,
          status: "captured",
          amount: Math.round(rupees * 100),
          currency: "INR",
          method: "upi",
          order_id: `order_${paymentId}`,
          notes: { order_id: orderId },
        },
      },
    },
  });
}

async function webhook(raw: string, signature?: string) {
  return new Client().post("/api/payments/razorpay/webhook", raw, {
    "content-type": "application/json",
    "x-razorpay-signature": signature ?? signWebhook(raw),
  });
}

test("E-P1: prepaid order weighed heavier — money owed shows, settle blocks until collected", async () => {
  const c = await as("customer");
  const o = await book(c, { method: "pay_now", amount: 100, weight: 1 });
  await testSettle(o.id);
  await drivePickup(o.id, "received_at_hub");
  const admin = await as("admin");
  await mustAct(admin, o.id, "weigh", { actual_weight: 10 });
  const w = await reload(o.id);
  assert.ok(Number(w.final_amount) > 100, `final_amount ${w.final_amount} not above the ₹100 paid`);
  const settle = await act(admin, o.id, "settle");
  assert.notEqual(
    settle.status,
    200,
    `settled a prepaid order short: paid ₹100, now costs ₹${w.final_amount}, payment_status=${w.payment_status}`
  );

  // Flow A step 13–14: ops collects the difference at the hub, then settles.
  const diff = Number(w.final_amount) - 100;
  await mustAct(admin, o.id, "collect_payment", { amount: diff, collection_mode: "upi" });
  assert.equal((await reload(o.id)).payment_status, "paid");
  await mustAct(admin, o.id, "settle");
});

test("E-P2: prepaid order weighed lighter — refund due is flagged (Flow D)", async () => {
  const c = await as("customer");
  const o = await book(c, { method: "pay_now", amount: 50000, weight: 20 });
  await testSettle(o.id);
  await drivePickup(o.id, "received_at_hub");
  const admin = await as("admin");
  await mustAct(admin, o.id, "weigh", { actual_weight: 0.5 });
  const w = await reload(o.id);
  assert.ok(Number(w.final_amount) < 50000, `final_amount ${w.final_amount}`);
  assert.equal(w.payment_status, "refund_due", `paid ₹50000, now costs ₹${w.final_amount}, payment_status=${w.payment_status}`);
});

test("E-P3: two parallel collect_payment calls record one payment", async () => {
  const c = await as("customer");
  const agent = await as("agentA");
  const o = await book(c, { method: "pay_at_pickup", amount: 700 });
  await drivePickup(o.id, "out_for_pickup");
  const body = { amount: 700, collection_mode: "cash" };
  const [a, b] = await Promise.all([act(agent, o.id, "collect_payment", body), act(agent, o.id, "collect_payment", body)]);
  const rows = await paymentRows(o.id);
  assert.equal(rows.length, 1, `two taps → ${rows.length} payment rows (statuses ${a.status}, ${b.status})`);
});

test("E-P4: collecting less than owed does not mark the order paid", async () => {
  const c = await as("customer");
  const agent = await as("agentA");
  const o = await book(c, { method: "pay_at_pickup", amount: 900 });
  await drivePickup(o.id, "out_for_pickup");
  const r = await act(agent, o.id, "collect_payment", { amount: 1, collection_mode: "cash" });
  const after = await reload(o.id);
  assert.notEqual(after.payment_status, "paid", `₹1 of ₹900 collected → ${after.payment_status} (reply ${r.status})`);
});

test("E-P5: booking refuses a negative / zero amount and a zero weight", async () => {
  const c = await as("customer");
  const neg = await c.post("/api/orders", bookingBody({ amount: -1 }));
  const zeroW = await c.post("/api/orders", bookingBody({ weight: 0 }));
  const statuses = `amount -1 → ${neg.status}; weight 0 → ${zeroW.status}`;
  assert.equal(neg.status, 400, statuses);
  assert.equal(zeroW.status, 400, statuses);
});

test("E-P6: webhook — bad signature refused, duplicate delivery records once", async () => {
  const c = await as("customer");
  const o = await book(c, { method: "pay_now", amount: 500 });
  const raw = capturedEvent(o.id, `pay_E2E${Date.now()}`, 500);
  assert.equal((await webhook(raw, "deadbeef")).status, 401);
  const first = await webhook(raw);
  const second = await webhook(raw);
  assert.equal(first.status, 200, first.text);
  assert.equal(second.status, 200, second.text);
  assert.equal((await paymentRows(o.id)).length, 1);
  assert.equal((await reload(o.id)).payment_status, "paid");
});

test("E-P7: a gateway payment landing on a cancelled order is flagged for refund", async () => {
  const c = await as("customer");
  const admin = await as("admin");
  const o = await book(c, { method: "pay_now", amount: 400 });
  await mustAct(admin, o.id, "cancel");
  const w = await webhook(capturedEvent(o.id, `pay_E2Ec${Date.now()}`, 400));
  assert.equal(w.status, 200, w.text);
  const after = await reload(o.id);
  assert.equal(after.payment_status, "refund_due", `money on a cancelled order → ${after.payment_status}`);
});

test("E-P8: cancelling a paid order flags a refund", async () => {
  const c = await as("customer");
  const admin = await as("admin");
  const o = await book(c, { method: "pay_now", amount: 600 });
  await testSettle(o.id);
  await mustAct(c, o.id, "request_cancellation", {});
  await mustAct(admin, o.id, "cancel");
  const after = await reload(o.id);
  assert.equal(after.status, "cancelled");
  assert.equal(after.payment_status, "refund_due", `paid then cancelled → ${after.payment_status}`);
});

test("E-P9: two partial payments that add up to the total read as paid", async () => {
  const c = await as("customer");
  const o = await book(c, { method: "pay_now", amount: 1000 });
  await webhook(capturedEvent(o.id, `pay_E2Ep1${Date.now()}`, 400));
  await webhook(capturedEvent(o.id, `pay_E2Ep2${Date.now()}`, 600));
  const after = await reload(o.id);
  assert.equal(after.payment_status, "paid", `₹400 + ₹600 of ₹1000 → ${after.payment_status}`);
});

test("E-L4: COD weighed heavier still settles and dockets (must never block)", async () => {
  const c = await as("customer");
  const o = await book(c, { method: "cod", amount: 100, weight: 1 });
  const done = await drivePickup(o.id, "dispatched", { weight: 8 });
  assert.equal(done.status, "dispatched");
  assert.ok(done.awb_no);
});

test("control: the pickup date gate uses IST today", async () => {
  const c = await as("customer");
  const agent = await as("agentA");
  const o = await book(c, { method: "cod" });
  await mustAct(agent, o.id, "claim");
  const early = await act(agent, o.id, "start_pickup");
  assert.equal(early.status, 403, "E-L7: started a pickup before its date");
  await makePickupToday(o.id);
  assert.equal((await act(agent, o.id, "start_pickup")).status, 200);
});
