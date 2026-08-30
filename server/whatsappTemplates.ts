/**
 * The touchpoint catalogue — every WhatsApp message this app can send.
 *
 * One entry per approved template. Adding a touchpoint is an entry here plus a
 * template approved in the Omni panel, and nothing else: the fan-out reads this
 * file and does not know what any individual message says.
 *
 * PURE. No DB, no network, no `Date.now()` beyond what is passed in. Every
 * function maps data to strings, which is what makes the whole catalogue
 * checkable by reading it.
 *
 * ── Meta's rules on variables, which are not negotiable ──────────────────
 * A body variable may not be empty, may not contain a newline or a tab, and
 * may not contain four or more consecutive spaces. Break any of those and the
 * send is rejected — not the message, the API call. `v()` below is the only
 * way a variable should ever be constructed.
 *
 * ── The rule that matters most ───────────────────────────────────────────
 * The pickup handover code goes to the CUSTOMER and to nobody else. An agent
 * who can read the code they are supposed to be typing is not being checked by
 * it, and the mechanism collapses into an extra tap (`handoverCodes.ts` §THE
 * ONE RULE). No agent template below takes a code, and none ever should.
 */

import type { Order, OrderStatus } from "../shared/orderContract.js";

// ── Template names ────────────────────────────────────────────────────────
//
// These strings must match the approved template names in the Omni panel
// exactly. A typo here is a `failed` row and a message nobody receives.

export const WA_TEMPLATE = {
  // Customer
  orderBooked: "bombino_order_booked",
  paymentReceived: "bombino_payment_received",
  paymentFailed: "bombino_payment_failed",
  pickupConfirmed: "bombino_pickup_confirmed",
  agentOnTheWay: "bombino_agent_on_the_way",
  parcelPickedUp: "bombino_parcel_picked_up",
  arrivedAtHub: "bombino_arrived_at_hub",
  amountDue: "bombino_amount_due",
  refundDue: "bombino_refund_due",
  dispatched: "bombino_dispatched",
  cancellationApproved: "bombino_cancellation_approved",
  cancellationDeclined: "bombino_cancellation_declined",
  loginOtp: "bombino_login_otp",
  // Agent
  agentNewJob: "bombino_agent_new_job",
  agentDailyDigest: "bombino_agent_daily_digest",
  agentJobCancelled: "bombino_agent_job_cancelled",
} as const;

export interface WhatsappMessage {
  template: string;
  variables: string[];
  /**
   * Appended to the dedupe key when the same template may legitimately be sent
   * twice for one order — a regenerated handover code, a second reprice.
   * Absent means once per order, ever.
   */
  dedupeSuffix?: string;
  /** Authentication templates only. */
  otpButtonCode?: string;
}

// ── Formatting ────────────────────────────────────────────────────────────

/**
 * A template variable, made safe.
 *
 * The fallback is a dash rather than an empty string because an empty variable
 * is a rejected API call, and losing one field of a message is better than
 * losing the message.
 */
function v(value: unknown, fallback = "-"): string {
  if (value === null || value === undefined) return fallback;
  const collapsed = String(value).replace(/\s+/g, " ").trim();
  return collapsed === "" ? fallback : collapsed;
}

/** Rupees, Indian grouping, no paise. `₹5,860`. */
export function money(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "-";
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(
    Math.abs(Math.round(amount))
  )}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * `2026-08-23` → `23 Aug`. Split on the string rather than parsed into a Date:
 * `pickup_date` is a bare calendar date, and handing it to a Date constructor
 * on a UTC server is how it becomes the 22nd.
 */
export function shortDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "-";
  const [year, month, day] = isoDate.split("-");
  const index = Number(month) - 1;
  if (!year || index < 0 || index > 11) return isoDate;
  return `${Number(day)} ${MONTHS[index]}`;
}

/** The public tracking page for a dispatched parcel. */
export function trackingUrl(awb: string): string {
  const base = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
  return base ? `${base}/shipment/${awb}` : `Bombino app → ${awb}`;
}

/**
 * The pickup city, for an agent deciding whether a job is worth taking.
 *
 * Not the full address: it goes in a notification an agent reads on a lock
 * screen, and the address is one tap away in the app. Also keeps a customer's
 * doorstep out of a message that fans out to every rostered agent.
 */
export function pickupArea(address: { city?: string | null; pincode?: string | null } | null): string {
  if (!address) return "-";
  const parts = [address.city, address.pincode].filter(Boolean);
  return parts.length > 0 ? v(parts.join(" ")) : "-";
}

// ── Customer touchpoints ──────────────────────────────────────────────────

export function orderBookedMessage(input: {
  order: Order;
  customerName: string | null;
}): WhatsappMessage {
  const isPickup = input.order.pickup_request === 1;
  return {
    template: WA_TEMPLATE.orderBooked,
    variables: [
      v(input.customerName, "there"),
      v(input.order.order_no),
      isPickup
        ? `Pickup on ${shortDate(input.order.pickup_date)}`
        : "Drop-off at the Bombino hub",
      money(input.order.quoted_amount),
    ],
  };
}

export function paymentReceivedMessage(input: {
  order: Order;
  amount: number;
  txnId: string | null;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.paymentReceived,
    variables: [v(input.order.order_no), money(input.amount), v(input.txnId, "—")],
    // A single order can take money more than once: a part payment at booking
    // and the reprice difference later. Keyed on the transaction so the second
    // receipt is not mistaken for a duplicate of the first.
    dedupeSuffix: input.txnId ?? String(Math.round(input.amount)),
  };
}

export function paymentFailedMessage(input: {
  order: Order;
  amount: number | null;
  attemptRef: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.paymentFailed,
    variables: [v(input.order.order_no), money(input.amount ?? input.order.quoted_amount)],
    // Failures repeat, and a customer retrying three times should be told
    // three times — otherwise the second failure is silent and they assume the
    // second attempt worked.
    dedupeSuffix: input.attemptRef,
  };
}

export function pickupConfirmedMessage(input: {
  order: Order;
  agentName: string | null;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.pickupConfirmed,
    variables: [
      v(input.order.order_no),
      v(input.agentName, "A Bombino agent"),
      shortDate(input.order.pickup_date),
    ],
  };
}

/**
 * The one that changes how the handover works.
 *
 * Until now the code lived only on the order screen: the customer had to have
 * the app open, logged in, on the right page, while the agent stood waiting.
 * Here it arrives on their phone before the doorbell.
 *
 * The code itself is the dedupe suffix. Same code, same message — so replaying
 * `start_pickup` sends nothing, while regenerating a locked code sends the new
 * number. Keying on anything else risks the second message being swallowed as
 * a duplicate, leaving the customer reading out a number that opens nothing.
 */
export function agentOnTheWayMessage(input: {
  order: Order;
  agentName: string | null;
  handoverCode: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.agentOnTheWay,
    variables: [
      v(input.order.order_no),
      v(input.agentName, "Your Bombino agent"),
      v(input.handoverCode),
    ],
    dedupeSuffix: input.handoverCode,
  };
}

export function parcelPickedUpMessage(order: Order): WhatsappMessage {
  return {
    template: WA_TEMPLATE.parcelPickedUp,
    variables: [v(order.order_no)],
  };
}

export function arrivedAtHubMessage(order: Order): WhatsappMessage {
  return {
    template: WA_TEMPLATE.arrivedAtHub,
    variables: [v(order.order_no)],
  };
}

/**
 * Repricing, in both directions.
 *
 * `weighed` is in `INTERNAL_ONLY_STATUSES` precisely so the customer sees
 * nothing between the hub and dispatch, and that rule stands for the in-app
 * fan-out. It does not stand here, and the difference is deliberate: a parcel
 * that weighed more than booked is not an internal event, it is a request for
 * money, and a customer who is never asked sits at `weighed` until somebody
 * telephones them.
 *
 * Keyed on the delta rather than on the status, so a reprice that comes out
 * even stays silent — which is the common case and needs no message at all.
 */
export function repriceMessage(input: {
  order: Order;
  quoted: number;
  final: number;
}): WhatsappMessage | null {
  const delta = Math.round(input.final - input.quoted);
  if (delta === 0) return null;

  const weight = input.order.actual_weight;
  const weightText = weight === null ? "-" : `${weight} kg`;

  if (delta > 0) {
    return {
      template: WA_TEMPLATE.amountDue,
      variables: [v(input.order.order_no), v(weightText), money(delta)],
      dedupeSuffix: String(delta),
    };
  }

  return {
    template: WA_TEMPLATE.refundDue,
    variables: [v(input.order.order_no), v(weightText), money(delta)],
    dedupeSuffix: String(delta),
  };
}

/**
 * Takes the order number rather than an `Order`, because the docket is written
 * by `persistShipment.ts`, which deals in shipments and may not be holding the
 * order row at all.
 */
export function dispatchedMessage(input: {
  orderNo: string;
  awb: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.dispatched,
    variables: [v(input.orderNo), v(input.awb), trackingUrl(input.awb)],
  };
}

export function cancellationApprovedMessage(order: Order): WhatsappMessage {
  return {
    template: WA_TEMPLATE.cancellationApproved,
    variables: [v(order.order_no)],
  };
}

export function cancellationDeclinedMessage(input: {
  order: Order;
  note: string | null;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.cancellationDeclined,
    variables: [
      v(input.order.order_no),
      v(input.note, "Your shipment is still going ahead."),
    ],
  };
}

export function loginOtpMessage(code: string): WhatsappMessage {
  return {
    template: WA_TEMPLATE.loginOtp,
    variables: [v(code)],
    otpButtonCode: code,
    // One row per code, not per phone. Requesting a second code must send a
    // second message — a resend that silently deduped would look to the
    // customer like the OTP simply never arrives.
    dedupeSuffix: code,
  };
}

// ── Agent touchpoints ─────────────────────────────────────────────────────
//
// None of these carries a handover code. See the header.

/**
 * A job has entered the pool.
 *
 * Says what an agent needs to decide whether to take it — where, when, and
 * whether they will be handling money — and nothing else. The doorstep address
 * and the customer's name stay in the app, because this message goes to every
 * agent rostered for the window, not to the one who ends up with the job.
 */
export function agentNewJobMessage(input: {
  order: Order;
  area: string;
}): WhatsappMessage {
  const collects =
    input.order.payment_method === "pay_at_pickup" && input.order.payment_status !== "paid";
  return {
    template: WA_TEMPLATE.agentNewJob,
    variables: [
      v(input.order.order_no),
      v(input.area),
      shortDate(input.order.pickup_date),
      collects ? `Collect ${money(input.order.quoted_amount)} at the door` : "Nothing to collect",
    ],
  };
}

export function agentDailyDigestMessage(input: {
  agentName: string | null;
  jobCount: number;
  date: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.agentDailyDigest,
    variables: [
      v(input.agentName, "there"),
      String(input.jobCount),
      // The approved template still has a third placeholder, which used to be
      // the first window of the day. Pickups carry no window now, so it is
      // filled with the same dash any absent variable gets — Meta rejects a
      // send whose variable count does not match the approved body, so the
      // placeholder cannot simply be dropped from this side. Retire it when
      // the template copy is resubmitted.
      "-",
    ],
    // One digest per agent per day. The date is what makes tomorrow's digest a
    // different message rather than a duplicate of today's.
    dedupeSuffix: input.date,
  };
}

// `agentSlotReminderMessage` is gone with the window it announced. The
// `bombino_agent_slot_reminder` template is still approved on Meta's side and
// can be archived there.

/**
 * The job the agent is holding has been disrupted.
 *
 * Prevents the concrete failure of an agent riding to an address for a parcel
 * ops has already cancelled.
 */
export function agentJobCancelledMessage(input: {
  order: Order;
  cancelled: boolean;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.agentJobCancelled,
    variables: [
      v(input.order.order_no),
      input.cancelled
        ? "This job has been cancelled. Do not collect."
        : "The customer has asked to cancel. Wait for ops before you travel.",
    ],
    dedupeSuffix: input.cancelled ? "cancelled" : "requested",
  };
}

// ── Status → template, for the central fan-out ────────────────────────────

/**
 * The plain status-change messages: one template, one order number, no extra
 * context to fetch. The three transitions that need more than the order row —
 * `agent_accepted` and `out_for_pickup` need the agent and the code, `weighed`
 * needs the reprice delta — are built by their own functions above and are
 * deliberately absent here.
 */
const SIMPLE_STATUS_MESSAGES: Partial<Record<OrderStatus, (order: Order) => WhatsappMessage>> = {
  picked_up: parcelPickedUpMessage,
  received_at_hub: arrivedAtHubMessage,
  cancelled: cancellationApprovedMessage,
};

export function simpleStatusMessage(order: Order): WhatsappMessage | null {
  const build = SIMPLE_STATUS_MESSAGES[order.status];
  return build ? build(order) : null;
}
