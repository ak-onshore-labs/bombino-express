import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrderWithAddress } from "./ordersDb.js";
import { handoverCodeLine, nextStepFor, normalizeOrderNo, orderPageLinks } from "./supportOrders.js";

// ─── normalizeOrderNo ────────────────────────────────────────────────────────

test("normalizeOrderNo accepts the ways people type an Order ID", () => {
  for (const raw of ["BOM-100231", "bom-100231", "BOM100231", "BOM 100231", "#BOM-100231", " 100231 "]) {
    assert.equal(normalizeOrderNo(raw), "BOM-100231", raw);
  }
});

test("normalizeOrderNo rejects what is not an Order ID", () => {
  for (const raw of ["", "BOM-", "BOM-12", "ABC-100231", "100231X", "BOM-100231; drop"]) {
    assert.equal(normalizeOrderNo(raw), null, raw);
  }
});

// ─── nextStepFor ─────────────────────────────────────────────────────────────

/** Only the fields nextStepFor reads; the rest of an order is irrelevant here. */
function order(fields: Partial<OrderWithAddress>): OrderWithAddress {
  return {
    status: "pickup_requested",
    pickup_request: 1,
    pickup_date: "2999-01-01",
    packaging_required: false,
    awb_no: null,
    final_amount: null,
    ...fields,
  } as OrderWithAddress;
}

const guest = { isGuest: true, riderName: null, counters: [] };
const account = { isGuest: false, riderName: null, counters: [] };

test("a drop-off code is only mentioned to an account, who has an order page", () => {
  const o = order({ status: "awaiting_dropoff", pickup_request: 2, pickup_date: null });
  assert.match(nextStepFor(o, account), /drop-off code from the order page/);
  assert.doesNotMatch(nextStepFor(o, guest), /code/);
  assert.match(nextStepFor(o, guest), /quote the Order ID/);
});

test("a pickup code is never read out, only where to find it", () => {
  const o = order({ status: "out_for_pickup" });
  assert.match(nextStepFor(o, account), /pickup code is on the order page/);
  assert.match(nextStepFor(o, guest), /WhatsApp/);
  assert.doesNotMatch(nextStepFor(o, account), /\b\d{4}\b/);
});

test("internal hub statuses all read as 'at our hub'", () => {
  for (const status of ["received_at_hub", "weighed", "settled", "ready_for_docket"] as const) {
    const step = nextStepFor(order({ status }), account);
    assert.match(step, /at our hub/, status);
    assert.doesNotMatch(step, /settled|ready.for.docket/i, status);
  }
});

test("a pickup day in the past is not presented as upcoming", () => {
  const step = nextStepFor(order({ status: "pickup_requested", pickup_date: "2020-01-01" }), account);
  assert.match(step, /has not happened yet/);
  assert.match(step, /support team/);
});

// ─── handoverCodeLine ────────────────────────────────────────────────────────

test("the code line says where a code is, never what it is", () => {
  for (const status of ["pickup_requested", "agent_accepted", "out_for_pickup", "awaiting_dropoff"] as const) {
    for (const isGuest of [true, false]) {
      const line = handoverCodeLine(order({ status }), isGuest);
      if (line) assert.doesNotMatch(line, /\d/, `${status} guest=${isGuest}`);
    }
  }
});

test("before a rider accepts, there is no pickup code yet", () => {
  assert.match(handoverCodeLine(order({ status: "pickup_requested" }), false) ?? "", /none issued yet/);
});

test("a guest dropping off has no code to look for", () => {
  assert.equal(handoverCodeLine(order({ status: "awaiting_dropoff", pickup_request: 2 }), true), null);
  assert.match(handoverCodeLine(order({ status: "awaiting_dropoff", pickup_request: 2 }), false) ?? "", /order page/);
});

test("once the parcel is with us, no code line at all", () => {
  for (const status of ["picked_up", "received_at_hub", "dispatched", "cancelled"] as const) {
    assert.equal(handoverCodeLine(order({ status }), false), null, status);
  }
});

test("a dispatched order points at its tracking number", () => {
  const step = nextStepFor(order({ status: "dispatched", awb_no: "12345678" }), account);
  assert.match(step, /AWB 12345678/);
});

// ─── orderPageLinks ──────────────────────────────────────────────────────────

test("an account is pointed at the order page's own buttons, never told BIA does it", () => {
  const cancellable = orderPageLinks(order({ order_no: "BOM-100107", status: "agent_accepted", user_id: "u1" }), false).join("\n");
  assert.match(cancellable, /TAP_VIEW_ORDER:BOM-100107#cancel/);
  assert.match(cancellable, /you can't cancel/);
  assert.match(cancellable, /TAP_VIEW_ORDER:BOM-100107#handover-code/);
  assert.doesNotMatch(cancellable, /#pay/);

  const owing = orderPageLinks(
    order({ order_no: "BOM-100200", status: "pickup_requested", user_id: "u1", payment_method: "pay_now", payment_status: "pending" }),
    false
  ).join("\n");
  assert.match(owing, /TAP_VIEW_ORDER:BOM-100200#pay/);
  assert.doesNotMatch(owing, /#handover-code/, "no code before a rider accepts");
});

test("a guest has no order page, and a finished order has nothing to press", () => {
  assert.deepEqual(orderPageLinks(order({ order_no: "BOM-100136", status: "awaiting_dropoff", pickup_request: 2 }), true), []);
  assert.deepEqual(orderPageLinks(order({ order_no: "BOM-100111", status: "dispatched", user_id: "u1" }), false), []);
});
