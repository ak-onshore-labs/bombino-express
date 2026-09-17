import { test } from "node:test";
import assert from "node:assert/strict";

import { availableActions, findTransition } from "./orderLifecycle.js";
import { todayInIst } from "../shared/istTime.js";
import type { Action, Order, OrderStatus } from "../shared/orderContract.js";

const AGENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function order(patch: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    order_no: "BOM0001",
    user_id: "user-1",
    status: "pickup_requested",
    pickup_request: 1,
    pickup_date: todayInIst(),
    origin_address_id: "addr-1",
    consignee: null,
    items: null,
    booked_weight: 2,
    quoted_amount: 1200,
    packaging_required: false,
    payment_method: "pay_now",
    payment_status: "paid",
    is_cod: false,
    agent_id: null,
    actual_weight: null,
    final_amount: null,
    awb_no: null,
    created_at: "2026-09-17T04:00:00Z",
    updated_at: "2026-09-17T04:00:00Z",
    ...patch,
  };
}

const actions = (o: Order, role: Parameters<typeof availableActions>[1], userId: string | null = null): Action[] =>
  availableActions(o, role, { userId }).map((a) => a.action);

test("an unclaimed pickup is offered to an agent, and to nobody else", () => {
  const unclaimed = order({ status: "pickup_requested" });
  assert.ok(actions(unclaimed, "agent", AGENT).includes("claim"));
  assert.equal(actions(unclaimed, "customer").includes("claim"), false);
});

test("a claimed job is not offered to a second agent", () => {
  const claimed = order({ status: "pickup_requested", agent_id: OTHER_AGENT });
  assert.equal(actions(claimed, "agent", AGENT).includes("claim"), false);
});

test("only the agent holding the job can start it", () => {
  const mine = order({ status: "agent_accepted", agent_id: AGENT });
  assert.ok(actions(mine, "agent", AGENT).includes("start_pickup"));
  assert.equal(actions(mine, "agent", OTHER_AGENT).includes("start_pickup"), false);
  // No session at all is not the owning agent either.
  assert.equal(actions(mine, "agent", null).includes("start_pickup"), false);
});

test("a pickup cannot start before the day it was promised for", () => {
  const tomorrow = order({ status: "agent_accepted", agent_id: AGENT, pickup_date: "2099-01-01" });
  assert.equal(actions(tomorrow, "agent", AGENT).includes("start_pickup"), false);

  // Late is not void: yesterday's parcel still has to be collected.
  const overdue = order({ status: "agent_accepted", agent_id: AGENT, pickup_date: "2020-01-01" });
  assert.ok(actions(overdue, "agent", AGENT).includes("start_pickup"));

  // A drop-off carries no date and is never held back by one.
  const dropoff = order({ status: "agent_accepted", agent_id: AGENT, pickup_date: null });
  assert.ok(actions(dropoff, "agent", AGENT).includes("start_pickup"));
});

test("an agent cannot leave the doorstep with the cash uncollected", () => {
  const owing = order({
    status: "out_for_pickup",
    agent_id: AGENT,
    payment_method: "pay_at_pickup",
    payment_status: "pending",
  });
  const offered = actions(owing, "agent", AGENT);
  assert.ok(offered.includes("collect_payment"));
  assert.equal(offered.includes("mark_picked_up"), false);

  const settled = order({
    status: "out_for_pickup",
    agent_id: AGENT,
    payment_method: "pay_at_pickup",
    payment_status: "paid",
  });
  const after = actions(settled, "agent", AGENT);
  assert.ok(after.includes("mark_picked_up"));
  assert.equal(after.includes("collect_payment"), false);
});

test("collecting payment does real work but does not move the order", () => {
  const owing = order({
    status: "out_for_pickup",
    agent_id: AGENT,
    payment_method: "pay_at_pickup",
    payment_status: "pending",
  });
  const transition = findTransition(owing, "collect_payment", "agent", { userId: AGENT });
  assert.ok(transition);
  assert.equal(transition.to, null);
  assert.equal(transition.requiresPayload, true);
});

test("a handover is payload-gated, so nothing is marked collected without the code", () => {
  const ready = order({ status: "out_for_pickup", agent_id: AGENT });
  const transition = findTransition(ready, "mark_picked_up", "agent", { userId: AGENT });
  assert.ok(transition);
  assert.equal(transition.requiresPayload, true);
  assert.equal(transition.to, "picked_up");
});

test("a refusal says only no — never which precondition failed", () => {
  const someoneElses = order({ status: "agent_accepted", agent_id: OTHER_AGENT });
  assert.equal(findTransition(someoneElses, "start_pickup", "agent", { userId: AGENT }), null);
  // Wrong status and wrong role answer the same way.
  assert.equal(findTransition(order({ status: "dispatched" }), "claim", "agent", { userId: AGENT }), null);
  assert.equal(findTransition(order(), "weigh", "customer"), null);
});

test("a super_admin may do what an admin may, and each action is offered once", () => {
  const atHub = order({ status: "received_at_hub" });
  const asAdmin = actions(atHub, "admin");
  const asSuper = actions(atHub, "super_admin");
  for (const action of asAdmin) {
    assert.ok(asSuper.includes(action), `super_admin lost ${action}`);
  }
  assert.equal(new Set(asSuper).size, asSuper.length, "an action was offered twice");
});

test("an admin is not an agent — ops never claims a pickup", () => {
  const unclaimed = order({ status: "pickup_requested" });
  assert.equal(actions(unclaimed, "admin").includes("claim"), false);
  assert.equal(actions(unclaimed, "super_admin").includes("claim"), false);
});

test("exactly one way out of settled, depending on whether a docket exists", () => {
  const needsDocket = actions(order({ status: "settled", awb_no: null }), "admin");
  assert.ok(needsDocket.includes("generate_docket"));
  assert.equal(needsDocket.includes("mark_dispatched"), false);

  const docketedAtBooking = actions(order({ status: "settled", awb_no: "AWB123" }), "admin");
  assert.ok(docketedAtBooking.includes("mark_dispatched"));
  assert.equal(docketedAtBooking.includes("generate_docket"), false);
});

test("a finished order offers nothing to anyone", () => {
  for (const status of ["dispatched", "cancelled"] as OrderStatus[]) {
    for (const role of ["customer", "agent", "admin", "super_admin"] as const) {
      assert.deepEqual(actions(order({ status }), role, AGENT), [], `${role} had something to do on ${status}`);
    }
  }
});
