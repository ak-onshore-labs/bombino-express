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

import { createHash } from "crypto";
import type { Order, OrderStatus } from "../shared/orderContract.js";

// ── Template names ────────────────────────────────────────────────────────
//
// These strings must match the approved template names in the Omni panel
// exactly. A typo here is a `failed` row and a message nobody receives.

/**
 * ON since 26 Oct 2026, when Tata's send step began accepting the templates
 * approved since 30 Sep (before that it answered "Template Not Found" for them
 * although their lookup showed them APPROVED; nothing new went out 13–26 Oct).
 * Set to false if that comes back: every message that has an older approved
 * template then goes on that one instead:
 *   order booked        bombino_order_booked (with the estimate) for _v2
 *   reweighed heavier   bombino_amount_due for bombino_extra_charge_due
 *   pickup cancelled    bombino_agent_job_cancelled for bombino_agent_pickup_cancelled
 *   agents' morning     bombino_agent_daily_digest for bombino_agent_morning_jobs
 * Messages with no older template try the new one either way.
 */
export const NEW_TEMPLATES_LIVE = true;

export const WA_TEMPLATE = {
  // Customer
  // _v2 drops the estimated amount; the price lives in the app, and the Note
  // line says the final figure comes after weighing. Templates cannot be
  // edited once approved, hence the new name.
  orderBooked: NEW_TEMPLATES_LIVE ? "bombino_order_booked_v2" : "bombino_order_booked",
  paymentReceived: "bombino_payment_received",
  paymentFailed: "bombino_payment_failed",
  pickupConfirmed: "bombino_pickup_confirmed",
  agentOnTheWay: "bombino_agent_on_the_way_v3",
  parcelPickedUp: "bombino_parcel_picked_up",
  arrivedAtHub: "bombino_arrived_at_hub",
  amountDue: "bombino_amount_due",
  refundDue: "bombino_refund_due",
  dispatched: "bombino_dispatched",
  cancellationApproved: "bombino_cancellation_approved",
  // _v2 takes the support number as {{3}}; v1 has +91 22 6640 0000 in its text.
  cancellationDeclined: NEW_TEMPLATES_LIVE ? "bombino_cancellation_declined_v2" : "bombino_cancellation_declined",
  loginOtp: "bombino_login_otp",
  // Authentication category, so Meta fixes the wording ("{code} is your
  // verification code.") and bolds the code. No security line (it says "do not
  // share", and this one is shared with the courier), no expiry (it lasts until
  // pickup). Custom button text was refused by Meta; the button is "Copy code".
  handoverCode: "bombino_handover_code",
  // Agent
  agentNewJob: "bombino_agent_new_job",
  agentDailyDigest: "bombino_agent_daily_digest",
  // Approved as Marketing, so only the cancellation *request* still uses it:
  // there is no Utility wording for "wait for ops" yet. An actual cancellation
  // goes as agentPickupCancelled (this one while NEW_TEMPLATES_LIVE is off).
  agentJobCancelled: "bombino_agent_job_cancelled",
  agentPickupCancelled: "bombino_agent_pickup_cancelled",
  agentJobAssigned: "bombino_agent_job_assigned",
  // `bombino_agent_job_reassigned` is approved but deliberately absent: a job
  // cannot be reassigned. Ops can only assign a pickup that has no agent
  // (`assignPickup` refuses one already held) and there is no unassign or
  // move action, so nothing could ever send it. Add it with that action.
  // Replaces agentDailyDigest in the morning run: same message without the
  // third placeholder the digest still carries for a window that is gone.
  agentMorningJobs: "bombino_agent_morning_jobs",
  // Customer, approved 14 Oct 2026 with the staff set.
  // extraChargeDue is amountDue for when the app cannot take the money: it
  // asks the customer to call instead of to pay in the app.
  extraChargeDue: "bombino_extra_charge_due",
  pickupReassigning: "bombino_pickup_reassigning",
  accountDecision: "bombino_account_decision",
  // Staff — the ops console's people. Who gets which is `notifyStaff.ts`, from
  // docs/final-phase/staff-whatsapp-templates.xlsx (all approved 14 Oct 2026).
  staffNewApplication: "bombino_staff_new_application",
  staffParcelAtHub: "bombino_staff_parcel_at_hub",
  staffWeighedHeavier: "bombino_staff_weighed_heavier",
  staffCustomerActionNeeded: "bombino_staff_customer_action_needed",
  staffNewPickup: "bombino_staff_new_pickup",
  staffAgentCancelled: "bombino_staff_agent_cancelled",
  staffCancellationRequest: "bombino_staff_cancellation_request",
  staffAwbFailed: "bombino_staff_awb_failed",
  staffRefundDue: "bombino_staff_refund_due",
  // Staff, on a clock (`staffSchedule.ts`).
  staffPickupsUnassigned: "bombino_staff_pickups_unassigned",
  staffPickupOverdue: "bombino_staff_pickup_overdue",
  staffDailySummary: "bombino_staff_daily_summary",
} as const;

/**
 * A stored phone number as people read it: `+91 98200 12345` for a mobile,
 * `+91 22 6640 0000` for a landline. Anything not ten digits comes back as
 * given.
 */
export function displayIndianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  if (ten.length !== 10) return phone.trim();
  return /^[6-9]/.test(ten)
    ? `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`
    : `+91 ${ten.slice(0, 2)} ${ten.slice(2, 6)} ${ten.slice(6)}`;
}

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
  /** The variables are a credential: store a placeholder, send the real thing. */
  redactVariables?: boolean;
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

/** `pickupArea` read off the booking's sender fields, for callers holding only the order. */
export function orderArea(order: Pick<Order, "items">): string {
  const items = (order.items && typeof order.items === "object" ? order.items : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : null);
  return pickupArea({ city: text(items.shipper_city), pincode: text(items.shipper_zip_code) });
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
      // v1's fourth placeholder, the estimate.
      ...(NEW_TEMPLATES_LIVE ? [] : [money(input.order.quoted_amount)]),
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
 * The agent is on the way.
 *
 * No handover code in it. It used to carry the code, and Meta rejected the
 * template as INCORRECT_CATEGORY: a Utility template may not deliver a code,
 * that is Authentication's job, and an Authentication template is Meta's fixed
 * "{{1}} is your verification code" with no room for an agent or an order. So
 * the message sends the customer to the order screen, which shows the code
 * (OrderDetails.tsx, #handover-code) and always shows the current one.
 *
 * _v3 because the rejected name cannot be reused through the API, and _v2,
 * which still said "see your pickup code… share it", was rejected by Meta's
 * automatic check on submission. Don't mention the code here at all.
 *
 * Once per order: nothing in it changes between sends.
 */
export function agentOnTheWayMessage(input: {
  order: Order;
  agentName: string | null;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.agentOnTheWay,
    variables: [v(input.order.order_no), v(input.agentName, "Your Bombino agent")],
  };
}

/**
 * The customer's pickup code, on its own. Sent right after `agentOnTheWay`,
 * which is what gives it meaning, and again whenever the code is regenerated.
 *
 * To the customer ONLY — see the header. The suffix is a hash of the code so a
 * regenerated code is a new message while a retried send of the same one is
 * not, without the code itself sitting in the dedupe key.
 */
export function handoverCodeMessage(code: string): WhatsappMessage {
  return {
    template: WA_TEMPLATE.handoverCode,
    variables: [code],
    otpButtonCode: code,
    redactVariables: true,
    dedupeSuffix: createHash("sha256").update(code).digest("hex").slice(0, 12),
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
 * `amountDue` for when online payment is off: the same news, but the customer
 * is asked to call rather than sent to an app that cannot take the money.
 * Same dedupe suffix as `amountDue`, so the two never both go for one reweigh.
 *
 * `supportPhone` is the office number from ops Settings, read at send time, so
 * changing it there changes this message with no new template and no deploy.
 */
export function extraChargeDueMessage(input: {
  order: Order;
  extra: number;
  supportPhone: string;
}): WhatsappMessage {
  const weight = input.order.actual_weight;
  return {
    template: WA_TEMPLATE.extraChargeDue,
    variables: [
      v(input.order.order_no),
      weight === null ? "-" : `${weight} kg`,
      money(input.extra),
      v(displayIndianPhone(input.supportPhone)),
    ],
    dedupeSuffix: String(Math.round(input.extra)),
  };
}

/**
 * The agent handed the pickup back. The customer would otherwise only notice
 * when nobody came, so they are told it is in hand. `at` is the agent's
 * cancellation, so a second agent dropping it is a second message.
 */
export function pickupReassigningMessage(input: { order: Order; at: string }): WhatsappMessage {
  return {
    template: WA_TEMPLATE.pickupReassigning,
    variables: [v(input.order.order_no)],
    dedupeSuffix: input.at,
  };
}

export type AccountDecision =
  | { kind: "approved" }
  | { kind: "sent_back" }
  | { kind: "declined"; reason: string | null };

/**
 * An account request decided. `{{2}}` is a whole sentence with its own full
 * stop: the approved body runs straight on into "Reply here…".
 */
export function accountDecisionMessage(decision: AccountDecision, at: string): WhatsappMessage {
  const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
  const [word, next] =
    decision.kind === "approved"
      ? ["approved", "You can now book shipments in the Bombino app."]
      : decision.kind === "sent_back"
        ? ["sent back", "Please open the Bombino app to see what to change."]
        : [
            "declined",
            decision.reason ? sentence(`Reason: ${v(decision.reason)}`) : "We could not open an account this time.",
          ];
  return {
    template: WA_TEMPLATE.accountDecision,
    variables: [word, v(next)],
    dedupeSuffix: `${decision.kind}:${at}`,
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

/**
 * The body is "Reason: {{2}}. Call us on {{3}}…", so the reason's own full
 * stop is dropped. `supportPhone` is the office number from ops Settings, read
 * at send time, as for `extraChargeDueMessage`.
 */
export function cancellationDeclinedMessage(input: {
  order: Order;
  note: string | null;
  supportPhone: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.cancellationDeclined,
    variables: [
      v(input.order.order_no),
      v(input.note, "Your shipment is still going ahead").replace(/\.+$/, ""),
      ...(NEW_TEMPLATES_LIVE ? [v(displayIndianPhone(input.supportPhone))] : []),
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
  return {
    template: WA_TEMPLATE.agentNewJob,
    variables: [
      v(input.order.order_no),
      v(input.area),
      shortDate(input.order.pickup_date),
      collectLine(input.order),
    ],
  };
}

/** The morning list: first name and a count. One per agent per day. */
export function agentMorningJobsMessage(input: {
  agentName: string | null;
  jobCount: number;
  date: string;
}): WhatsappMessage {
  const first = v(input.agentName, "there").split(" ")[0];
  return {
    template: WA_TEMPLATE.agentMorningJobs,
    variables: [v(first, "there"), String(input.jobCount)],
    dedupeSuffix: input.date,
  };
}

/**
 * Whether money changes hands at the door. No full stop: every template that
 * takes it supplies its own.
 */
export function collectLine(order: Order): string {
  const collects = order.payment_method === "pay_at_pickup" && order.payment_status !== "paid";
  return collects ? `Collect ${money(order.quoted_amount)} at the door` : "Nothing to collect";
}

/**
 * The branch gave this agent a pickup. `at` is when, so a job handed back and
 * then given to the same agent again is a second message rather than a
 * duplicate of the first.
 */
export function agentJobAssignedMessage(input: {
  order: Order;
  area: string;
  at: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.agentJobAssigned,
    variables: [
      v(input.order.order_no),
      v(input.area),
      shortDate(input.order.pickup_date),
      collectLine(input.order),
    ],
    dedupeSuffix: input.at,
  };
}

export function agentPickupCancelledMessage(input: {
  order: Order;
  area: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.agentPickupCancelled,
    variables: [v(input.order.order_no), v(input.area)],
    dedupeSuffix: "cancelled",
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

// ── Staff touchpoints ─────────────────────────────────────────────────────
//
// To the ops console's people, never to a customer. These only say it; who
// hears which is `notifyStaff.ts`. Some carry the customer's name and number
// because support and the branch are expected to call them (team review,
// question 6).

function kg(weight: number | null): string {
  return weight === null ? "-" : `${weight} kg`;
}

/** A free-text reason cut to something a lock screen shows whole. */
function brief(text: string | null | undefined, max = 120): string {
  const value = v(text);
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/** Where a cancellable order has got to, in the words the branch uses. */
const STAFF_STAGE: Partial<Record<OrderStatus, string>> = {
  pickup_requested: "no agent yet",
  agent_accepted: "agent assigned",
  out_for_pickup: "agent on the way",
  awaiting_dropoff: "waiting for drop-off",
};

/** `at` is the submission time, so a re-submission is a message of its own. */
export function staffNewApplicationMessage(input: {
  resent: boolean;
  name: string;
  accountType: string;
  phone: string;
  at: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.staffNewApplication,
    variables: [input.resent ? "updated" : "new", v(input.name), v(input.accountType), v(input.phone)],
    dedupeSuffix: input.at,
  };
}

export function staffParcelAtHubMessage(input: {
  order: Order;
  city: string | null;
  customer: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.staffParcelAtHub,
    variables: [
      v(input.order.order_no),
      v(input.city, "Bombino"),
      input.order.pickup_request === 2 ? "customer drop-off" : "pickup by agent",
      v(input.customer),
    ],
  };
}

export function staffWeighedHeavierMessage(input: {
  order: Order;
  extra: number;
  customer: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.staffWeighedHeavier,
    variables: [
      v(input.order.order_no),
      kg(input.order.actual_weight),
      kg(input.order.booked_weight),
      money(input.extra),
      v(input.customer),
    ],
    // Same key as the customer's amount-due message: a second reweigh to a
    // different figure is news, the same figure twice is not.
    dedupeSuffix: String(Math.round(input.extra)),
  };
}

export function staffCustomerActionNeededMessage(input: {
  order: Order;
  missing: string;
  customer: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.staffCustomerActionNeeded,
    variables: [v(input.order.order_no), brief(input.missing), v(input.customer)],
  };
}

export function staffNewPickupMessage(input: { order: Order; area: string }): WhatsappMessage {
  return {
    template: WA_TEMPLATE.staffNewPickup,
    variables: [
      v(input.area),
      v(input.order.order_no),
      shortDate(input.order.pickup_date),
      collectLine(input.order),
    ],
  };
}

/** `at` is the agent's cancellation, so a second agent dropping it is told too. */
export function staffAgentCancelledMessage(input: {
  order: Order;
  agentName: string | null;
  area: string;
  at: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.staffAgentCancelled,
    variables: [
      v(input.agentName, "An agent"),
      v(input.order.order_no),
      v(input.area),
      shortDate(input.order.pickup_date),
    ],
    dedupeSuffix: input.at,
  };
}

export function staffCancellationRequestMessage(input: {
  order: Order;
  city: string | null;
  reason: string | null;
  at: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.staffCancellationRequest,
    variables: [
      v(input.order.order_no),
      v(input.city),
      v(STAFF_STAGE[input.order.status] ?? input.order.status.replace(/_/g, " ")),
      brief(input.reason, 100).replace(/^-$/, "none given"),
    ],
    dedupeSuffix: input.at,
  };
}

/** Keyed on the stage, so ops pressing Retry into the same wall is not re-told. */
export function staffAwbFailedMessage(input: {
  order: Order;
  city: string | null;
  reason: string;
  stage: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.staffAwbFailed,
    variables: [v(input.order.order_no), v(input.city), brief(input.reason)],
    dedupeSuffix: input.stage,
  };
}

export function staffRefundDueMessage(input: {
  order: Order;
  amount: number;
  customer: string;
  reason: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.staffRefundDue,
    variables: [v(input.order.order_no), money(input.amount), v(input.customer), v(input.reason)],
    dedupeSuffix: String(Math.round(input.amount)),
  };
}

/** `slot` tells the morning reminder from the evening one for the same date. */
export function staffPickupsUnassignedMessage(input: {
  count: number;
  city: string | null;
  date: string;
  slot: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.staffPickupsUnassigned,
    variables: [String(input.count), v(input.city, "your city"), shortDate(input.date)],
    dedupeSuffix: `${input.date}:${input.slot}`,
  };
}

/** Once per order per evening: `runDate` is the day it was found still waiting. */
export function staffPickupOverdueMessage(input: {
  order: Order;
  city: string | null;
  agentName: string | null;
  runDate: string;
}): WhatsappMessage {
  return {
    template: WA_TEMPLATE.staffPickupOverdue,
    variables: [
      v(input.order.order_no),
      v(input.city),
      shortDate(input.order.pickup_date),
      v(input.agentName, "none"),
    ],
    dedupeSuffix: input.runDate,
  };
}

export interface DailySummary {
  newBookings: number;
  collected: number;
  atHub: number;
  dispatched: number;
  /** Already worded: "2 pickups unassigned today, 1 AWB failed". Empty for none. */
  attention: string[];
}

/** `city` null means every city, for admins. `date` is the day summarised. */
export function staffDailySummaryMessage(input: {
  city: string | null;
  date: string;
  summary: DailySummary;
}): WhatsappMessage {
  const { summary } = input;
  return {
    template: WA_TEMPLATE.staffDailySummary,
    variables: [
      v(input.city, "All cities"),
      shortDate(input.date),
      String(summary.newBookings),
      String(summary.collected),
      String(summary.atHub),
      String(summary.dispatched),
      // Never blank: a variable cannot be empty, and "nothing" is the news.
      brief(summary.attention.join(", "), 200).replace(/^-$/, "nothing pending"),
    ],
    dedupeSuffix: input.date,
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
