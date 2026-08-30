/**
 * M0 item 6 — the order state machine.
 *
 * One data entry per legal `status × action × role` triple. Everything else is
 * derived from this table: `availableActions()` for the UI, and the guard
 * checks the action endpoint runs before it writes.
 *
 * Adding a transition means adding a row here and nothing else. No lifecycle
 * knowledge belongs in a route handler or in a component.
 *
 * IMPORTANT: a guard evaluated here is advisory — it decides which buttons to
 * show and rejects an illegal request early. It is NOT the concurrency
 * boundary. Anything that can be raced (claiming a pickup) must ALSO express
 * its precondition in the SQL WHERE clause of the UPDATE that performs it, or
 * two agents will both pass the guard and both write. See `claim` below.
 */

import type {
  Action,
  AvailableAction,
  Order,
  OrderStatus,
  Role,
} from "../shared/orderContract.js";
import {
  hasOpenCancellationRequest,
  isPaymentSatisfied,
  roleSatisfies,
} from "../shared/orderContract.js";
import { todayInIst } from "../shared/istTime.js";

/**
 * Context the guards need beyond the order itself — chiefly "who is asking",
 * so an agent can only act on a job they personally hold.
 */
export interface TransitionContext {
  /** `itd_users.id` of the caller. Null for unauthenticated callers. */
  userId: string | null;
}

export interface Transition {
  from: OrderStatus;
  action: Action;
  role: Role;
  /**
   * The status after the action. `null` means the action does real work but
   * does not move the order — `collect_payment` writes a `payments` row and
   * leaves the status alone.
   */
  to: OrderStatus | null;
  label: string;
  requiresPayload?: boolean;
  /**
   * Extra precondition beyond status+role. Omitted means status+role is
   * sufficient. Must be pure and synchronous — no DB reads.
   */
  guard?: (order: Order, ctx: TransitionContext) => boolean;
}

// ── Guards ────────────────────────────────────────────────────────────────

/** The order is unclaimed. Race-prone: mirror as `.is('agent_id', null)`. */
const isUnclaimed = (order: Order): boolean => order.agent_id === null;

/** The caller is the agent holding this job. */
const isOwningAgent = (order: Order, ctx: TransitionContext): boolean =>
  ctx.userId !== null && order.agent_id === ctx.userId;

/**
 * The pickup date has arrived.
 *
 * Claiming ahead is normal — an agent plans tomorrow's route today — but
 * *starting* a job is a statement that they are on their way, and that cannot
 * be true before the day the customer was promised. Without this an agent can
 * run a 5 Aug pickup to completion on the 4th, and the customer gets a
 * doorbell a day early or a parcel marked collected that nobody collected.
 *
 * Compares `YYYY-MM-DD` strings, where lexicographic order is chronological
 * order. `todayInIst` is used rather than `new Date()` because the server runs
 * in UTC while `pickup_date` is an Indian calendar date — between 18:30 and
 * midnight UTC the two disagree, which is the middle of an Indian evening.
 *
 * Deliberately `<=`, not `===`: a pickup that slipped to the next day is late,
 * not void, and the parcel still has to be collected. Blocking an overdue job
 * would strand it with no available action and no way back — ops cannot
 * rescue it either, since those handlers are not built yet. Change to `===`
 * if a missed date should instead require rebooking.
 */
const pickupDateArrived = (order: Order): boolean => {
  if (!order.pickup_date) return true; // drop-offs and legacy rows carry none
  return order.pickup_date <= todayInIst();
};

/** Money is owed at the door and has not been taken yet. */
const owesAtPickup = (order: Order): boolean =>
  order.payment_method === "pay_at_pickup" && order.payment_status !== "paid";

/** Money is owed at the counter and has not been taken yet. */
const owesAtDropoff = (order: Order): boolean =>
  order.payment_method === "pay_at_dropoff" && order.payment_status !== "paid";

// ── The table ─────────────────────────────────────────────────────────────

export const TRANSITIONS: readonly Transition[] = [
  // ── Agent, pickup path (A5) ────────────────────────────────────────────
  {
    from: "pickup_requested",
    action: "claim",
    role: "agent",
    to: "agent_accepted",
    label: "Accept pickup",
    // Advisory only. The winner is decided by the conditional UPDATE:
    //   .eq('status','pickup_requested').is('agent_id', null)
    // Two agents can both pass this guard; exactly one can pass that WHERE.
    guard: isUnclaimed,
  },
  {
    from: "agent_accepted",
    action: "start_pickup",
    role: "agent",
    to: "out_for_pickup",
    label: "Start pickup",
    // Only on or after the promised day. Everything downstream — collection,
    // pickup, hub handoff — is reachable only through here, so gating this one
    // transition keeps a future-dated job out of the whole flow without
    // stranding a late one mid-way.
    guard: (order, ctx) => isOwningAgent(order, ctx) && pickupDateArrived(order),
  },
  {
    // No status change — collection is a `payments` write, and the order is
    // still out_for_pickup afterwards.
    from: "out_for_pickup",
    action: "collect_payment",
    role: "agent",
    to: null,
    label: "Collect payment",
    requiresPayload: true,
    guard: (order, ctx) => isOwningAgent(order, ctx) && owesAtPickup(order),
  },
  {
    from: "out_for_pickup",
    action: "mark_picked_up",
    role: "agent",
    to: "picked_up",
    label: "Mark picked up",
    // The customer's handover code. Without it an agent can mark a parcel
    // collected from the pavement outside.
    requiresPayload: true,
    // Cannot leave the doorstep with the cash uncollected.
    guard: (order, ctx) => isOwningAgent(order, ctx) && !owesAtPickup(order),
  },
  {
    // The agent closes their own job, but not on their own say-so: the hub code
    // is on ops' console and appears nowhere in the agent app, so typing it is
    // proof the agent reached the counter and someone there read it out.
    //
    // The verifier is the agent and the owner is ops — the reverse of the
    // pickup, and the same rule (`handoverCodes.ts`: never return a code to the
    // party that types it in). Ops still has `override_handover` below for a
    // dead phone.
    //
    // This is the last thing the agent does with the parcel: `received_at_hub`
    // has no `role: agent` row, so the job leaves their queue the moment it
    // lands.
    from: "picked_up",
    action: "mark_received_at_hub",
    role: "agent",
    to: "received_at_hub",
    label: "Hand over at hub",
    requiresPayload: true,
    guard: isOwningAgent,
  },

  // ── Ops, drop-off path + hub (M2/M3/M5) ────────────────────────────────
  // Listed so `availableActions` is complete for every role from day one.
  // The handlers behind them are Arbaaz's; the vocabulary is shared.
  {
    from: "awaiting_dropoff",
    action: "mark_received_dropoff",
    role: "admin",
    to: "received_at_hub",
    label: "Mark received",
    // The customer's dropoff code, read from their app at the counter. Same
    // shape as the pickup handover, different pair of hands.
    requiresPayload: true,
  },

  // ── Handover override (ops) ────────────────────────────────────────────
  // One row per OTP-gated step, each landing where the gated action would
  // have. A dead phone must not strand a parcel — but only ops can wave it
  // through, and every use writes an `order_events` row naming them.
  {
    from: "out_for_pickup",
    action: "override_handover",
    role: "admin",
    to: "picked_up",
    label: "Complete without code",
    requiresPayload: true,
  },
  {
    from: "picked_up",
    action: "override_handover",
    role: "admin",
    to: "received_at_hub",
    label: "Complete without code",
    requiresPayload: true,
  },
  {
    from: "awaiting_dropoff",
    action: "override_handover",
    role: "admin",
    to: "received_at_hub",
    label: "Complete without code",
    requiresPayload: true,
  },
  {
    from: "received_at_hub",
    action: "weigh",
    role: "admin",
    to: "weighed",
    label: "Weigh parcel",
    requiresPayload: true,
  },
  {
    from: "weighed",
    action: "collect_payment",
    role: "admin",
    to: null,
    label: "Collect payment",
    requiresPayload: true,
    guard: owesAtDropoff,
  },
  {
    from: "weighed",
    action: "settle",
    role: "admin",
    to: "settled",
    label: "Settle",
    // The hard gate: weight captured AND payment satisfied. COD passes the
    // payment half by design and must never be blocked here.
    guard: (order) => order.actual_weight !== null && isPaymentSatisfied(order),
  },
  {
    from: "settled",
    action: "generate_docket",
    role: "admin",
    to: "dispatched",
    label: "Generate docket",
    // Irreversible in ITD. The double-fire guard is a DB-level precondition
    // (`awb_no IS NULL` in the UPDATE), not this check — M5 owns it.
    guard: (order) => order.awb_no === null,
  },

  // ── Cancellation ───────────────────────────────────────────────────────
  //
  // Two different verbs, deliberately asymmetric.
  //
  // The customer *requests*. They do not cancel: by the time they change their
  // mind an agent may already be riding to their door, money may have moved,
  // and the decision has costs the customer cannot see. So their button writes
  // a request and nothing else — the order does not move (`to: null`) and the
  // agent keeps working it until ops says otherwise.
  //
  // Ops *cancels*. They see the request on the board and act on it, or they
  // cancel without one when the customer phones in. The request is a signal,
  // not a precondition — gating ops on it would strand every order cancelled
  // over the phone, which is most of them.
  //
  // Both stop before the parcel is physically with us. Once it is at the hub,
  // cancelling is a conversation, not a button.
  ...(
    ["pickup_requested", "awaiting_dropoff", "agent_accepted"] as const
  ).flatMap((from): Transition[] => [
    {
      from,
      action: "request_cancellation",
      role: "customer",
      // No status change. The request is a note on the order, not a move.
      to: null,
      label: "Request cancellation",
      // Optional reason.
      requiresPayload: true,
      // Asking twice is not a second request, and a button that stays live
      // after it has been pressed reads as one that did nothing.
      guard: (order) => !hasOpenCancellationRequest(order),
    },
    // Two `cancel` rows, same effect, different words. `availableActions`
    // dedupes by action name and keeps the first match, so ops reads "Approve
    // cancellation" when they are answering a customer and "Cancel order" when
    // they are acting on their own. The ops console renders `label` verbatim
    // and needs no code for this.
    {
      from,
      action: "cancel",
      role: "admin",
      to: "cancelled",
      label: "Approve cancellation",
      guard: hasOpenCancellationRequest,
    },
    { from, action: "cancel", role: "admin", to: "cancelled", label: "Cancel order" },
    {
      from,
      action: "reject_cancellation",
      role: "admin",
      // The order does not move — declining a request means it carries on
      // exactly as it was, which is the entire point.
      to: null,
      label: "Decline cancellation",
      // Optional note, shown to the customer.
      requiresPayload: true,
      // Nothing to decline without an open request.
      guard: hasOpenCancellationRequest,
    },
  ]),
] as const;

// ── Lookup ────────────────────────────────────────────────────────────────

/**
 * Every action the caller may legally perform on this order right now.
 *
 * The UI renders one control per entry and nothing else. An empty array is a
 * legitimate answer — a customer looking at a dispatched order, or an agent
 * looking at a job that has reached the hub.
 */
export function availableActions(
  order: Order,
  role: Role,
  ctx: TransitionContext = { userId: null }
): AvailableAction[] {
  const seen = new Set<Action>();
  const out: AvailableAction[] = [];

  for (const t of TRANSITIONS) {
    if (t.from !== order.status) continue;
    if (!roleSatisfies(role, t.role)) continue;
    if (t.guard && !t.guard(order, ctx)) continue;
    // A super_admin matches both its own rows and the admin rows; dedupe so
    // the UI never renders the same button twice.
    if (seen.has(t.action)) continue;

    seen.add(t.action);
    out.push({
      action: t.action,
      label: t.label,
      ...(t.requiresPayload ? { requiresPayload: true } : {}),
    });
  }

  return out;
}

/**
 * Resolve one requested action to its transition row, or null when the caller
 * may not perform it. Null covers every refusal reason — wrong status, wrong
 * role, failed guard — deliberately: telling a caller *which* precondition
 * they failed leaks other users' state (e.g. that another agent holds a job).
 */
export function findTransition(
  order: Order,
  action: Action,
  role: Role,
  ctx: TransitionContext = { userId: null }
): Transition | null {
  for (const t of TRANSITIONS) {
    if (t.from !== order.status) continue;
    if (t.action !== action) continue;
    if (!roleSatisfies(role, t.role)) continue;
    if (t.guard && !t.guard(order, ctx)) continue;
    return t;
  }
  return null;
}

/** Every action name the table knows — used to separate 400 from 403. */
export const KNOWN_ACTIONS: readonly Action[] = Array.from(
  new Set(TRANSITIONS.map((t) => t.action))
);

export function isKnownAction(value: unknown): value is Action {
  return typeof value === "string" && (KNOWN_ACTIONS as readonly string[]).includes(value);
}
