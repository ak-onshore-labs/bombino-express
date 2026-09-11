/**
 * BIA's view of the customer's orders — read-only.
 *
 * Every executor here answers for whoever the *session* says is asking: an
 * account (`dbUserId`) or a guest proved by OTP (`guestRef`). The model can only
 * name an order number; whether the caller may see it is decided in SQL by
 * `findOrderForOwner`. Someone else's order reads exactly like one that does
 * not exist.
 *
 * What never leaves this file, whatever the model asks for:
 *   - the internal statuses `weighed` / `settled` / `ready_for_docket` — the
 *     customer's view sits still at "Arrived at Bombino hub" through all three
 *   - handover codes — BIA points at where the code is, never reads it out
 *   - staff ids, phone numbers, cost breakdowns
 *
 * Output is plain text for the model plus `TAP_*` button tokens, which the
 * model is told to pass through and the route re-validates (`supportCta.ts`),
 * and cards for the client (`shared/biaCards.ts`), which the model never sees.
 */

import { listRecentShipmentsByUserId } from "./appDb.js";
import { listGuestOrders } from "./guestProfileDb.js";
import { getKycByGuestRef, getKycByUserId } from "./kycDb.js";
import { availableActions } from "./orderLifecycle.js";
import {
  findOrderForOwner,
  getUserContactsByIds,
  listOrderEvents,
  listOrdersByUserId,
  type OrderOwner,
  type OrderWithAddress,
} from "./ordersDb.js";
import { getCoverage } from "./pickupCoverageDb.js";
import { lookupPostal } from "./postalLookup.js";
import type { SupportChatContext, ToolOutcome } from "./supportTypes.js";
import {
  toneForCarrierStatus,
  toneForOrderStatus,
  type OrderCard,
  type PickupCard,
} from "../shared/biaCards.js";
import { dropoffBranchesFor } from "../shared/branches.js";
import { earliestPickupDate, todayInIst } from "../shared/istTime.js";
import {
  cancellationState,
  customerStatusForStatus,
  deriveCustomerStatus,
  isInternalOnlyStatus,
  isTerminalOrderStatus,
  readCancellationRequest,
  type OrderStatus,
} from "../shared/orderContract.js";
import { formatCutoffHour, getPickupServiceability } from "../shared/pickupPincodes.js";

// ─── Owner ───────────────────────────────────────────────────────────────────

/** Who is asking, from the session alone. Null for an anonymous visitor. */
export function ownerOf(context: SupportChatContext): OrderOwner | null {
  if (context.user && context.dbUserId) return { kind: "account", userId: context.dbUserId };
  if (context.guestRef) return { kind: "guest", guestRef: context.guestRef };
  return null;
}

const NOT_SIGNED_IN =
  "The user is not signed in and has not verified a phone number, so their orders cannot be looked up. Ask them to sign in, or to verify their phone from the Ship screen if they booked as a guest. If they have an AWB, you can track that instead.";

// ─── Formatting ──────────────────────────────────────────────────────────────

/**
 * `BOM-100231` from however the customer typed it: "bom100231",
 * "BOM 100231", "#100231". Null when it is not an order number at all.
 */
export function normalizeOrderNo(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/^#/, "");
  const match = s.match(/^(?:BOM)?[\s-]*(\d{6,9})$/);
  return match ? `BOM-${match[1]}` : null;
}

export function formatInr(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** An instant as India reads it: "3 Sep, 4:05 pm". */
function formatIstInstant(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatIstDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
}

/**
 * A bare `YYYY-MM-DD` (`orders.pickup_date`) as "today", "tomorrow" or
 * "Wed, 3 Sep". Read at UTC midnight so the calendar day cannot drift.
 */
function formatCalendarDay(day: string | null | undefined): string {
  if (!day) return "—";
  const today = todayInIst();
  if (day === today) return "today";
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (day === tomorrow.toISOString().slice(0, 10)) return "tomorrow";
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
}

/** A card's date: "3 Sep", or null rather than a dash. */
function dayOrNull(iso: string | null | undefined): string | null {
  const day = formatIstDay(iso);
  return day === "—" ? null : day;
}

/** Where an order card goes: the order screen for an account, My shipments for a guest. */
function orderHref(orderNo: string, owner: OrderOwner): string {
  return owner.kind === "account" ? `/order/${orderNo}` : "/orders";
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** "New York, United States" off the consignee jsonb, read defensively. */
function destinationOf(consignee: unknown): string {
  if (!consignee || typeof consignee !== "object") return "—";
  const c = consignee as Record<string, unknown>;
  return [text(c.city), text(c.country_name)].filter(Boolean).join(", ") || "—";
}

/** Same words as the order screen (`client/src/lib/orderDetail.ts`). */
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pay_now: "Pay online",
  pay_at_pickup: "Pay at pickup",
  pay_at_dropoff: "Pay at drop-off",
  cod: "Pay at delivery",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  paid: "Paid",
  partially_paid: "Partially paid",
  refund_due: "Refund due",
  failed: "Failed",
};

/** A `TAP_LOCATIONS` token, carrying the state the counter list should open on. */
function locationsToken(state: string | null | undefined): string {
  const s = text(state);
  return s ? `TAP_LOCATIONS:${encodeURIComponent(s)}` : "TAP_LOCATIONS";
}

function buttonsLine(tokens: string[]): string {
  const unique = Array.from(new Set(tokens));
  return unique.length > 0 ? `\nButtons (copy each onto its own line at the end of your reply):\n${unique.join("\n")}` : "";
}

// ─── list_my_orders ──────────────────────────────────────────────────────────

const LIST_LIMIT = 5;

interface ListItem {
  label: string;
  at: number;
  button: string | null;
  orderNo: string | null;
  card: OrderCard;
}

export async function executeListMyOrders(context: SupportChatContext): Promise<ToolOutcome> {
  const owner = ownerOf(context);
  if (!owner) return { content: NOT_SIGNED_IN };

  try {
    const items: ListItem[] = [];

    if (owner.kind === "account") {
      const [orders, shipments] = await Promise.all([
        listOrdersByUserId(owner.userId),
        listRecentShipmentsByUserId(owner.userId, LIST_LIMIT),
      ]);
      if (orders === null && shipments === null) {
        return { content: "Orders could not be loaded right now. Ask the user to try again in a moment, or to check My shipments." };
      }

      const orderAwbs = new Set<string>();
      for (const o of orders ?? []) {
        if (o.awb_no) orderAwbs.add(o.awb_no);
        items.push({
          label: `${o.order_no}${o.awb_no ? ` (AWB ${o.awb_no})` : ""} · To ${destinationOf(o.consignee)} · ${customerStatusForStatus(o.status)} · Booked ${formatIstDay(o.created_at)}`,
          at: new Date(o.updated_at ?? o.created_at).getTime() || 0,
          button: `TAP_VIEW_ORDER:${o.order_no}`,
          orderNo: o.order_no,
          card: {
            kind: "order",
            orderNo: o.order_no,
            awb: o.awb_no ?? null,
            destination: destinationOf(o.consignee),
            status: customerStatusForStatus(o.status),
            tone: toneForOrderStatus(o.status, { overdue: pickupOverdue(o) }),
            bookedOn: dayOrNull(o.created_at),
            href: orderHref(o.order_no, owner),
          },
        });
      }
      // Shipments booked before orders existed, or whose order is not theirs to
      // list any more. An AWB already shown with its order is not repeated.
      for (const s of shipments ?? []) {
        if (!s.awb_number || orderAwbs.has(s.awb_number)) continue;
        const to = [text(s.consignee_city), text(s.consignee_country)].filter(Boolean).join(", ") || "—";
        items.push({
          label: `AWB ${s.awb_number} · To ${to} · ${text(s.current_status) || "Booked"} · Booked ${formatIstDay(s.booking_date ?? s.created_at)}`,
          at: new Date(s.created_at).getTime() || 0,
          button: `TAP_TRACK:${s.awb_number}`,
          orderNo: null,
          card: {
            kind: "order",
            orderNo: null,
            awb: s.awb_number,
            destination: to,
            status: text(s.current_status) || "Booked",
            tone: toneForCarrierStatus(text(s.current_status)),
            bookedOn: dayOrNull(s.booking_date ?? s.created_at),
            href: `/shipment/${s.awb_number}`,
          },
        });
      }
    } else {
      const orders = await listGuestOrders(owner.guestRef);
      for (const o of orders) {
        items.push({
          label: `${o.order_no}${o.awb_no ? ` (AWB ${o.awb_no})` : ""} · To ${[o.city, o.country].filter(Boolean).join(", ") || o.destination || "—"} · ${customerStatusForStatus(o.status)} · Booked ${formatIstDay(o.created_at)}`,
          at: new Date(o.updated_at ?? o.created_at).getTime() || 0,
          // A guest has no order screen; once there is an AWB, public tracking is theirs.
          button: o.awb_no ? `TAP_TRACK:${o.awb_no}` : null,
          orderNo: o.order_no,
          card: {
            kind: "order",
            orderNo: o.order_no,
            awb: o.awb_no,
            destination: [o.city, o.country].filter(Boolean).join(", ") || o.destination || "—",
            status: customerStatusForStatus(o.status),
            tone: toneForOrderStatus(o.status),
            bookedOn: dayOrNull(o.created_at),
            href: orderHref(o.order_no, owner),
          },
        });
      }
    }

    if (items.length === 0) {
      return {
        content: "The user has no orders yet. Offer to help them book one.\nTAP_CREATE_SHIPMENT",
      };
    }

    items.sort((a, b) => b.at - a.at);
    const shown = items.slice(0, LIST_LIMIT);
    const lines = shown.map((item, i) => `${i + 1}. ${item.label}`);
    const more =
      items.length > shown.length
        ? `\n(${items.length} in total; showing the ${shown.length} most recently updated. The rest are in My shipments.)`
        : "";
    const buttons = [
      ...shown.map((item) => item.button).filter((b): b is string => !!b),
      "TAP_MY_ORDERS",
    ];

    return {
      content: `Most recently updated first:\n${lines.join("\n")}${more}${buttonsLine(buttons)}`,
      orderNos: shown.map((item) => item.orderNo).filter((n): n is string => !!n),
      cards: shown.map((item) => item.card),
    };
  } catch {
    return { content: "Orders could not be loaded right now. Ask the user to try again in a moment." };
  }
}

// ─── get_order_status ────────────────────────────────────────────────────────

/** While the rider's name means something to the customer. Mirrors the order screen. */
const RIDER_VISIBLE_STATUSES: readonly OrderStatus[] = ["agent_accepted", "out_for_pickup", "picked_up"];

/** What the timeline would call this event, or null when the customer never sees it. */
function visibleEventLabel(status: string, metadata: Record<string, unknown> | null): string | null {
  const action = metadata?.action;
  if (action === "collect_payment") return "Payment collected";
  if (action === "request_cancellation") return "Cancellation requested";
  if (action === "reject_cancellation") return "Cancellation declined";
  if (isInternalOnlyStatus(status as OrderStatus)) return null;
  return customerStatusForStatus(status);
}

/**
 * What the customer should do or expect next — derived from state, never
 * guessed by the model.
 */
export function nextStepFor(
  order: OrderWithAddress,
  opts: { isGuest: boolean; riderName: string | null; counters: string[] }
): string {
  const rider = opts.riderName ? `Rider ${opts.riderName}` : "A rider";
  const pickupDay = formatCalendarDay(order.pickup_date);
  const packing = order.packaging_required ? " The rider brings packing material, since they asked us to pack it." : "";

  if (pickupOverdue(order)) {
    return `The pickup booked for ${pickupDay} has not happened yet. Our support team can arrange it. Keep the parcel ready.`;
  }

  switch (order.status) {
    case "pickup_requested":
      return `Pickup is booked for ${pickupDay}. A rider will accept the job and come to the pickup address. Keep the parcel ready.${packing}`;
    case "agent_accepted":
      return opts.isGuest
        ? `${rider} has accepted the pickup for ${pickupDay}. We send the pickup code on WhatsApp when the rider sets out; they share it only once the rider is at their door.${packing}`
        : `${rider} has accepted the pickup for ${pickupDay}. The pickup code is on the order page (and comes on WhatsApp when the rider sets out); they share it only once the rider is at their door.${packing}`;
    case "out_for_pickup":
      return opts.isGuest
        ? `${rider} is on the way. The pickup code is in the WhatsApp message we just sent; share it only when the rider is at the door.`
        : `${rider} is on the way. The pickup code is on the order page and in WhatsApp; share it only when the rider is at the door.`;
    case "picked_up":
      return "The parcel is with the rider, on its way to our hub. There it is weighed, the final amount is confirmed, and the tracking number (AWB) is issued.";
    case "awaiting_dropoff": {
      const where =
        opts.counters.length > 0
          ? ` Nearest counters: ${opts.counters.join(" | ")}.`
          : " The Locations page lists every counter.";
      return opts.isGuest
        ? `Bring the parcel to a Bombino counter and quote the Order ID.${where}`
        : `Bring the parcel to a Bombino counter and show the drop-off code from the order page.${where}`;
    }
    case "received_at_hub":
    case "weighed":
    case "settled":
    case "ready_for_docket":
      if (order.awb_no) {
        return "The parcel is at our hub. Its tracking number is already issued; tracking starts showing movement once it is dispatched.";
      }
      // Weighed is internal as a status, but the customer was told the final
      // amount when it happened, so "it has been weighed" is no secret.
      return order.final_amount !== null
        ? "The parcel is at our hub and has been weighed. Next the tracking number (AWB) is issued and it is dispatched."
        : "The parcel is at our hub. We weigh it, confirm the final amount, then issue the tracking number (AWB) and dispatch it.";
    case "dispatched":
      return order.awb_no
        ? `It has been dispatched and is in transit. Track it with AWB ${order.awb_no}.`
        : "It has been dispatched and is in transit.";
    case "cancelled":
      return "This order is cancelled. Nothing more will happen to it.";
    default:
      return "Our team is processing this order.";
  }
}

function moneyLines(order: OrderWithAddress): string[] {
  const lines: string[] = [];
  const method = PAYMENT_METHOD_LABELS[order.payment_method] ?? order.payment_method;
  const isCod = order.is_cod || order.payment_method === "cod";
  const status = isCod ? "collected at the destination, not by Bombino" : PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status;
  lines.push(`Payment: ${method} (${status})`);

  const quoted = num(order.quoted_amount);
  const final = num(order.final_amount);
  if (quoted !== null) lines.push(`Estimated at booking: ${formatInr(quoted)}`);
  if (final !== null) {
    // No delta arithmetic: nothing in the system records what is owed either
    // way, and a paid order whose price rose still reads `paid`. State the
    // facts and hand the difference to the team.
    const changed = quoted !== null && Math.abs(final - quoted) >= 1;
    lines.push(
      `Final amount after weighing: ${formatInr(final)}${
        changed ? " (different from the estimate; our team contacts the customer about the difference)" : ""
      }`
    );
  }

  if (order.status !== "cancelled") {
    if (order.payment_method === "pay_now" && order.payment_status === "pending") {
      lines.push("Online payment is still pending.");
    } else if (order.payment_status === "failed") {
      lines.push("The last payment attempt failed.");
    }
  }
  if (order.payment_status === "refund_due") {
    lines.push("A refund is due. Our team arranges it and gets in touch.");
  }
  return lines;
}

function cancellationLine(order: OrderWithAddress, isGuest: boolean): string {
  const state = cancellationState(order);
  const request = readCancellationRequest(order);
  // A declined request is closed, so the order page offers the button again.
  const canRequest =
    !isGuest &&
    availableActions(order, "customer", { userId: order.user_id }).some(
      (a) => a.action === "request_cancellation"
    );
  switch (state) {
    case "pending":
      return "Cancellation: the customer asked to cancel; the request is with our team, and the order continues until they decide.";
    case "rejected":
      return [
        "Cancellation: our team declined the request; the order is going ahead.",
        request?.decision_note ? `Their note, to quote word for word: "${request.decision_note}"` : "",
        canRequest ? "They can ask again from the order page." : "",
      ]
        .filter(Boolean)
        .join(" ");
    case "approved": {
      const prepaid = order.payment_method === "pay_now" && order.payment_status !== "pending";
      return `Cancellation: cancelled.${prepaid ? " Refunds on a cancelled prepaid order are handled by our team over the phone." : ""}`;
    }
    default:
      if (canRequest) return "Cancellation: they can ask to cancel from the order page if they need to.";
      if (isTerminalOrderStatus(order.status)) return "";
      if (isGuest) {
        return "Cancellation: a guest booking is cancelled by our support team; they should contact support.";
      }
      // Past the point the app offers it: the rider is out, or the parcel is with us.
      return "Cancellation: it can no longer be requested in the app, because the parcel is already on its way to us or with us. Our support team can advise.";
  }
}

/**
 * Where the customer's handover code is, if the order has one — never the code
 * itself. Stated as a fact on every order so "tell me my code" gets a real
 * answer rather than a reply about something else.
 */
export function handoverCodeLine(order: OrderWithAddress, isGuest: boolean): string | null {
  switch (order.status) {
    case "pickup_requested":
      return "Pickup code: none issued yet. It is issued once a rider accepts the pickup.";
    case "agent_accepted":
    case "out_for_pickup":
      return isGuest
        ? "Pickup code: sent on WhatsApp when the rider sets out. Never state it; say where it is."
        : "Pickup code: on the order page, and on WhatsApp when the rider sets out. Never state it; say where it is.";
    case "awaiting_dropoff":
      // A guest has no order page; they quote the Order ID at the counter.
      return isGuest ? null : "Drop-off code: on the order page. Never state it; say where it is.";
    default:
      return null;
  }
}

/**
 * Pickup statuses in which nobody is on the way yet. `out_for_pickup` is left
 * out: a rider riding to the door today is the pickup happening, whatever day
 * it was booked for.
 */
const AWAITING_COLLECTION: readonly OrderStatus[] = ["pickup_requested", "agent_accepted"];

/**
 * True when the booked pickup day is behind us and the parcel still has not
 * been collected. Seeded and slipped orders both do this; saying "pickup on
 * 18 Aug" in September would read as a promise.
 */
function pickupOverdue(order: { pickup_request: number; pickup_date: string | null; status: string }): boolean {
  return (
    order.pickup_request === 1 &&
    !!order.pickup_date &&
    order.pickup_date < todayInIst() &&
    (AWAITING_COLLECTION as readonly string[]).includes(order.status)
  );
}

async function describeOrder(order: OrderWithAddress, owner: OrderOwner): Promise<ToolOutcome> {
  const isGuest = owner.kind === "guest";

  const [events, contacts] = await Promise.all([
    listOrderEvents(order.id),
    order.agent_id && RIDER_VISIBLE_STATUSES.includes(order.status)
      ? getUserContactsByIds([order.agent_id])
      : Promise.resolve(new Map()),
  ]);
  const riderName = order.agent_id ? (contacts.get(order.agent_id)?.full_name ?? null) : null;

  let lastUpdate = "—";
  for (const ev of [...(events ?? [])].reverse()) {
    const label = visibleEventLabel(ev.status, ev.metadata);
    if (label) {
      lastUpdate = `${label}, ${formatIstInstant(ev.created_at)}`;
      break;
    }
  }

  const addr = order.origin_address;
  const counters =
    order.status === "awaiting_dropoff"
      ? dropoffBranchesFor(addr?.pincode, addr?.city, addr?.state)
          .slice(0, 2)
          .map((b) => `${b.city}: ${b.address}`)
      : [];

  const lines: string[] = [
    `Order ${order.order_no}`,
    `Status: ${deriveCustomerStatus(order)}`,
    `Last update: ${lastUpdate}`,
    order.pickup_request === 2
      ? "How it reaches us: drop-off at a Bombino counter"
      : `How it reaches us: doorstep pickup, ${formatCalendarDay(order.pickup_date)}${addr?.city ? `, from ${addr.city}` : ""}`,
    `To: ${destinationOf(order.consignee)}`,
    ...moneyLines(order),
    order.awb_no
      ? `Tracking number (AWB): ${order.awb_no}`
      : order.status === "cancelled"
        ? "Tracking number (AWB): none, the order was cancelled."
        : num(order.final_amount) !== null
          ? "Tracking number (AWB): not issued yet. The parcel has been weighed; the tracking number comes with dispatch."
          : "Tracking number (AWB): not issued yet. It is issued once the parcel has been weighed at our hub.",
  ];
  const code = handoverCodeLine(order, isGuest);
  if (code) lines.push(code);
  const cancellation = cancellationLine(order, isGuest);
  if (cancellation) lines.push(cancellation);
  // A guest has no cancel button anywhere in the app; support is the only way,
  // so the reply must carry the way to reach them.
  const guestCancelsViaSupport = isGuest && !isTerminalOrderStatus(order.status);
  if (guestCancelsViaSupport) {
    lines.push(
      "Important: if the user wants to cancel, say our support team cancels guest bookings and include TAP_CONTACT_US."
    );
  }
  if (riderName) lines.push(`Rider: ${riderName}`);
  const overdue = pickupOverdue(order);
  if (overdue) {
    lines.push(
      `Important: the booked pickup day (${formatCalendarDay(order.pickup_date)}) has passed and the parcel has not been collected yet. Do not present that date as upcoming. Suggest they contact our support team to arrange the pickup.`
    );
  }
  lines.push(`What happens next: ${nextStepFor(order, { isGuest, riderName, counters })}`);

  const buttons: string[] = [];
  if (overdue || guestCancelsViaSupport) buttons.push("TAP_CONTACT_US");
  if (!isGuest) buttons.push(`TAP_VIEW_ORDER:${order.order_no}`);
  if (order.awb_no && order.status === "dispatched") buttons.push(`TAP_TRACK:${order.awb_no}`);
  if (order.status === "awaiting_dropoff") buttons.push(locationsToken(addr?.state));
  if (isGuest) buttons.push("TAP_MY_ORDERS");
  if (!isGuest && cancellationState(order) !== "none") buttons.push("TAP_CANCELLATIONS");

  const card: OrderCard = {
    kind: "order",
    orderNo: order.order_no,
    awb: order.awb_no ?? null,
    destination: destinationOf(order.consignee),
    status: deriveCustomerStatus(order),
    tone: toneForOrderStatus(order.status, { overdue }),
    bookedOn: dayOrNull(order.created_at),
    href: orderHref(order.order_no, owner),
  };

  return { content: `${lines.join("\n")}${buttonsLine(buttons)}`, orderNos: [order.order_no], cards: [card] };
}

export async function executeGetOrderStatus(
  args: { order_no?: string },
  context: SupportChatContext
): Promise<ToolOutcome> {
  const owner = ownerOf(context);
  if (!owner) return { content: NOT_SIGNED_IN };

  const orderNo = normalizeOrderNo(String(args.order_no ?? ""));
  if (!orderNo) {
    return { content: "That is not an Order ID. Order IDs look like BOM-100231. Ask the user to check it, or call list_my_orders." };
  }

  try {
    const order = await findOrderForOwner({ orderNo }, owner);
    if (!order) {
      return {
        content: `No order ${orderNo} was found on this ${owner.kind === "guest" ? "phone number" : "account"}. Ask the user to check the number, or offer to list their orders.`,
      };
    }
    return await describeOrder(order, owner);
  } catch {
    return { content: "That order could not be loaded right now. Ask the user to try again in a moment." };
  }
}

/**
 * The caller's own order behind an AWB, if they have one. Lets tracking fall
 * back to what we know when ITD knows nothing yet — an order docketed moments
 * ago, or one ops closed out by hand.
 */
export async function describeOwnedOrderByAwb(
  awb: string,
  context: SupportChatContext
): Promise<ToolOutcome | null> {
  const owner = ownerOf(context);
  if (!owner) return null;
  try {
    const order = await findOrderForOwner({ awb }, owner);
    return order ? await describeOrder(order, owner) : null;
  } catch {
    return null;
  }
}

// ─── get_my_kyc_status ───────────────────────────────────────────────────────

/**
 * Smart OCR verdicts that read as verified. The same set `KycOnFileCard` uses:
 * while Bombino is on Cashfree test credentials the check is bypassed silently,
 * and the customer is never told a check was skipped.
 */
const OCR_VERIFIED = new Set(["match", "skipped", "bypassed"]);

export async function executeGetMyKycStatus(context: SupportChatContext): Promise<ToolOutcome> {
  const owner = ownerOf(context);
  if (!owner) return { content: NOT_SIGNED_IN };

  try {
    const kyc =
      owner.kind === "account" ? await getKycByUserId(owner.userId) : await getKycByGuestRef(owner.guestRef);
    if (!kyc) {
      return {
        content:
          "No identity document is on file yet. It is asked for once: at signup, or on the first guest booking. It never holds up a shipment.",
      };
    }
    const lastFour = kyc.document_no.trim().slice(-4);
    const verified = !kyc.ocr_status || OCR_VERIFIED.has(kyc.ocr_status);
    return {
      content: [
        `Identity document on file: ${kyc.document_type} ending ${lastFour}, uploaded ${formatIstDay(kyc.updated_at)}.`,
        verified
          ? "Status: verified. Nothing more is needed."
          : "Status: on file. If anything more is needed, the app will say so.",
        "Their identity check never holds up an order or its tracking number.",
      ].join("\n"),
    };
  } catch {
    return { content: "The identity document could not be checked right now. It never holds up a shipment either way." };
  }
}

// ─── check_pickup ────────────────────────────────────────────────────────────

export async function executeCheckPickup(args: { pincode?: string }): Promise<ToolOutcome> {
  const pincode = String(args.pincode ?? "").replace(/\s+/g, "");
  if (!/^[0-9]{6}$/.test(pincode)) {
    return { content: "Ask for the 6-digit Indian pincode the parcel will be collected from." };
  }

  try {
    const coverage = await getCoverage();
    const area = getPickupServiceability(pincode, coverage.areas);

    if (area.serviceable) {
      const earliest = earliestPickupDate(area.cutoffHour);
      const lines = [
        `Doorstep pickup is available at ${pincode} (${area.area}, ${area.city}).`,
        `Same-day cut-off: ${formatCutoffHour(area.cutoffHour)} IST. The earliest pickup if they book now is ${formatCalendarDay(earliest)}.`,
      ];
      if (area.remark === "out_of_city") {
        lines.push("This pincode is outside the rider's normal round, so an extra charge may apply. It is settled when the parcel is weighed.");
      }
      const card: PickupCard = {
      kind: "pickup",
        pincode,
        place: [area.area, area.city].filter(Boolean).join(", ") || null,
        available: true,
        cutoff: formatCutoffHour(area.cutoffHour),
        earliest: formatCalendarDay(earliest),
        outOfCity: area.remark === "out_of_city",
        counters: [],
        state: null,
      };
      return { content: `${lines.join("\n")}${buttonsLine(["TAP_CREATE_SHIPMENT"])}`, cards: [card] };
    }

    const place = await lookupPostal("IN", pincode);
    const branches = place.found ? dropoffBranchesFor(pincode, place.city, place.state) : [];
    const where = place.found ? ` (${place.city}, ${place.state})` : "";
    const counters =
      branches.length > 0
        ? `They can drop the parcel at a Bombino counter:\n${branches
            .slice(0, 3)
            .map((b, i) => `${i + 1}. ${b.city}: ${b.address}`)
            .join("\n")}`
        : "They can drop the parcel at any Bombino counter; the Locations page lists them all.";
    const card: PickupCard = {
      kind: "pickup",
      pincode,
      place: place.found ? [place.city, place.state].filter(Boolean).join(", ") : null,
      available: false,
      cutoff: null,
      earliest: null,
      outOfCity: false,
      counters: branches.slice(0, 3).map((b) => ({ city: b.city, address: b.address })),
      state: place.found ? place.state : null,
    };
    return {
      content: `Doorstep pickup is not available at ${pincode}${where} yet.\n${counters}${buttonsLine([
        locationsToken(place.found ? place.state : null),
        "TAP_CREATE_SHIPMENT",
      ])}`,
      cards: [card],
    };
  } catch {
    return { content: "Pickup coverage could not be checked right now. The booking form checks it too, as soon as the pincode is entered." };
  }
}

// ─── Suggestions ─────────────────────────────────────────────────────────────

const DEFAULT_CHIPS = ["Get shipping rates", "Is pickup available at my pincode?", "Track a shipment"] as const;

/**
 * Starter chips for an empty chat, led by the caller's own live orders. Asked
 * as questions so tapping one reads naturally in the transcript.
 */
export async function suggestionsFor(context: SupportChatContext): Promise<string[]> {
  const owner = ownerOf(context);
  const chips: string[] = [];

  try {
    if (owner?.kind === "account") {
      const orders = (await listOrdersByUserId(owner.userId)) ?? [];
      for (const o of orders) {
        if (isTerminalOrderStatus(o.status)) continue;
        chips.push(chipFor(o.order_no, o.status));
        if (chips.length === 2) break;
      }
    } else if (owner?.kind === "guest") {
      const orders = await listGuestOrders(owner.guestRef);
      for (const o of orders) {
        if (isTerminalOrderStatus(o.status)) continue;
        chips.push(chipFor(o.order_no, o.status));
        if (chips.length === 2) break;
      }
    }
  } catch {
    /* chips are a convenience — fall through to the defaults */
  }

  if (owner && chips.length === 0) chips.push("Show my orders");
  for (const c of DEFAULT_CHIPS) {
    if (chips.length >= 4) break;
    chips.push(c);
  }
  return chips;
}

function chipFor(orderNo: string, status: string): string {
  switch (status) {
    case "pickup_requested":
    case "agent_accepted":
    case "out_for_pickup":
      return `When is my pickup for ${orderNo}?`;
    case "awaiting_dropoff":
      return `Where do I drop off ${orderNo}?`;
    default:
      return `Where is ${orderNo}?`;
  }
}
