import { test } from "node:test";
import assert from "node:assert/strict";

// No database: these assertions are about what the handlers refuse before they
// reach one, and about what they answer when the data layer is unavailable —
// which, with no Supabase configured, is exactly the shape of a failed write.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.DATABASE_URL;

const {
  HANDOVER_CODE_OWNER,
  HANDOVER_KIND_FOR_ACTION,
  HANDOVER_KIND_FOR_STATUS,
  handleCollectPayment,
  handleHandover,
  handleOverrideHandover,
  handleRejectCancellation,
  handleRequestCancellation,
} = await import("./orderActions.js");

type Order = import("../shared/orderContract.js").Order;

const CALLER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function order(patch: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    order_no: "BOM0001",
    user_id: "user-1",
    status: "out_for_pickup",
    pickup_request: 1,
    pickup_date: "2026-09-17",
    origin_address_id: "addr-1",
    consignee: null,
    items: null,
    booked_weight: 2,
    quoted_amount: 1200,
    packaging_required: false,
    payment_method: "pay_at_pickup",
    payment_status: "pending",
    is_cod: false,
    agent_id: CALLER,
    actual_weight: null,
    final_amount: null,
    awb_no: null,
    created_at: "2026-09-17T04:00:00Z",
    updated_at: "2026-09-17T04:00:00Z",
    ...patch,
  };
}

/** The error a refusal carries, or null when the handler succeeded. */
function refusal(result: Awaited<ReturnType<typeof handleCollectPayment>>) {
  return "error" in result ? result.error : null;
}

// ── Collecting money ────────────────────────────────────────────────────────

test("a customer cannot collect payment on their own order", async () => {
  const e = refusal(
    await handleCollectPayment({
      order: order(),
      callerId: CALLER,
      role: "customer",
      payload: { amount: 100, collection_mode: "cash" },
    })
  );
  assert.equal(e?.status, 403);
  assert.equal(e?.code, "FORBIDDEN");
});

test("each collection point only takes the money it is for", async () => {
  // An agent at the door, on an order due at the counter.
  const atDoor = refusal(
    await handleCollectPayment({
      order: order({ payment_method: "pay_at_dropoff" }),
      callerId: CALLER,
      role: "agent",
      payload: { amount: 100, collection_mode: "cash" },
    })
  );
  assert.equal(atDoor?.status, 400);
  assert.equal(atDoor?.code, "PAYMENT_METHOD_MISMATCH");
  assert.match(atDoor?.message ?? "", /pay-at-pickup/);

  // Ops at the counter, on an order due at the door.
  const atCounter = refusal(
    await handleCollectPayment({
      order: order({ payment_method: "pay_at_pickup" }),
      callerId: CALLER,
      role: "admin",
      payload: { amount: 100, collection_mode: "cash" },
    })
  );
  assert.equal(atCounter?.code, "PAYMENT_METHOD_MISMATCH");
  assert.match(atCounter?.message ?? "", /pay-at-drop-off/);
});

test("how the money moved is required, and the amount must be real", async () => {
  const noMode = refusal(
    await handleCollectPayment({
      order: order(),
      callerId: CALLER,
      role: "agent",
      payload: { amount: 100 },
    })
  );
  assert.equal(noMode?.status, 400);
  assert.equal(noMode?.code, "INVALID_PAYLOAD");
  assert.equal(noMode?.message, "Choose UPI or cash");

  for (const amount of [0, -50]) {
    const bad = refusal(
      await handleCollectPayment({
        order: order(),
        callerId: CALLER,
        role: "agent",
        payload: { amount, collection_mode: "upi" },
      })
    );
    assert.equal(bad?.code, "INVALID_PAYLOAD", `accepted ${amount}`);
  }
});

test("a payment that could not be written stops the handover in as many words", async () => {
  const e = refusal(
    await handleCollectPayment({
      order: order(),
      callerId: CALLER,
      role: "agent",
      payload: { amount: 1200, collection_mode: "cash" },
    })
  );
  assert.equal(e?.status, 502);
  assert.equal(e?.code, "PAYMENT_WRITE_FAILED");
  assert.match(e?.message ?? "", /Do not hand over the parcel/);
});

// ── Handovers ───────────────────────────────────────────────────────────────

test("a handover needs a four-digit code, and says so in words an agent can act on", async () => {
  const missing = refusal(
    await handleHandover({
      order: order(),
      callerId: CALLER,
      role: "agent",
      action: "mark_picked_up",
      expectedFrom: "out_for_pickup",
      to: "picked_up",
      payload: {},
    })
  );
  assert.equal(missing?.status, 400);
  assert.equal(missing?.code, "OTP_REQUIRED");
  assert.equal(missing?.message, "Enter the code");

  for (const otp of ["12", "12345", "abcd"]) {
    const bad = refusal(
      await handleHandover({
        order: order(),
        callerId: CALLER,
        role: "agent",
        action: "mark_picked_up",
        expectedFrom: "out_for_pickup",
        to: "picked_up",
        payload: { otp },
      })
    );
    assert.equal(bad?.message, "Enter the 4-digit code", `accepted ${otp}`);
  }
});

test("a code that cannot be checked is our failure, not the customer's", async () => {
  const e = refusal(
    await handleHandover({
      order: order(),
      callerId: CALLER,
      role: "agent",
      action: "mark_picked_up",
      expectedFrom: "out_for_pickup",
      to: "picked_up",
      payload: { otp: "1234" },
    })
  );
  assert.equal(e?.status, 502);
  assert.equal(e?.code, "OTP_ERROR");
});

test("every handover action maps to a kind, and every kind names whose code it is", () => {
  for (const [action, kind] of Object.entries(HANDOVER_KIND_FOR_ACTION)) {
    assert.ok(HANDOVER_CODE_OWNER[kind], `${action} has no code owner`);
  }
  // The statuses an ops override can act from, and what each waves through.
  assert.equal(HANDOVER_KIND_FOR_STATUS.out_for_pickup, "pickup");
  assert.equal(HANDOVER_KIND_FOR_STATUS.picked_up, "hub");
  assert.equal(HANDOVER_KIND_FOR_STATUS.awaiting_dropoff, "dropoff");
  // A status with no handover due must not be overridable into one.
  assert.equal(HANDOVER_KIND_FOR_STATUS.settled, undefined);
});

test("an override is refused without a reason — the only thing auditing it", async () => {
  for (const payload of [{}, { reason: "  " }, { reason: "no" }]) {
    const e = refusal(
      await handleOverrideHandover({
        order: order(),
        callerId: CALLER,
        expectedFrom: "out_for_pickup",
        to: "picked_up",
        payload,
      })
    );
    assert.equal(e?.status, 400, JSON.stringify(payload));
    assert.equal(e?.code, "REASON_REQUIRED");
  }

  const tooLong = refusal(
    await handleOverrideHandover({
      order: order(),
      callerId: CALLER,
      expectedFrom: "out_for_pickup",
      to: "picked_up",
      payload: { reason: "x".repeat(301) },
    })
  );
  assert.equal(tooLong?.code, "REASON_REQUIRED");
});

// ── Cancellation ────────────────────────────────────────────────────────────

test("a cancellation note is optional but bounded", async () => {
  const e = refusal(
    await handleRequestCancellation({
      order: order({ status: "pickup_requested" }),
      callerId: CALLER,
      payload: { reason: "x".repeat(301) },
    })
  );
  assert.equal(e?.status, 400);
  assert.equal(e?.code, "INVALID_PAYLOAD");

  // An empty payload is fine — it reaches the write, which has no database here.
  const noReason = refusal(
    await handleRequestCancellation({
      order: order({ status: "pickup_requested" }),
      callerId: CALLER,
      payload: {},
    })
  );
  assert.equal(noReason?.code, "ORDER_STATE_CHANGED");
});

test("declining a cancellation that is not open is a 409, not a silent no-op", async () => {
  const e = refusal(
    await handleRejectCancellation({
      order: order(),
      callerId: CALLER,
      payload: { note: "Parcel is already with the airline." },
    })
  );
  assert.equal(e?.status, 409);
  assert.equal(e?.code, "NO_OPEN_REQUEST");
});
