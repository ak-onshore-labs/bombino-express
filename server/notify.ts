/**
 * The notification fan-out — one event in, every channel out.
 *
 * Replaces the inline block that lived at the bottom of the action endpoint in
 * `routes.ts`. That block was marked provisional pending M6 (Status Sync), and
 * this file is deliberately the shape M6 was specced to build
 * (final-phase-modules.md §M6). WHEN M6 LANDS IT SHOULD ABSORB THIS FILE
 * RATHER THAN ADD A THIRD FAN-OUT — the failure mode being guarded against is
 * a customer receiving the same message twice from two places that each think
 * they own it.
 *
 * Two channels, different rules, on purpose:
 *
 *   in-app   every customer-visible transition, silent on the three internal
 *            ones (`isInternalOnlyStatus`), silent when the customer is the
 *            actor. Unchanged from what the inline block did.
 *
 *   WhatsApp the same, plus two exceptions. A reprice at `weighed` is sent
 *            even though `weighed` is internal, because being asked for money
 *            is not an internal event. And the booking confirmation is sent
 *            even though the customer is the actor, because a receipt for a
 *            thing you just did is the one self-triggered message people
 *            expect.
 *
 * NON-FATAL, ABSOLUTELY. Every function here returns void and swallows its own
 * failures. A parcel moves whether or not anyone can be told about it.
 */

import type { Order } from "../shared/orderContract.js";
import { deriveCustomerStatus, isInternalOnlyStatus } from "../shared/orderContract.js";
import { insertOrderStatusNotification } from "./appDb.js";
import { customerStatusDetail } from "./notificationCopy.js";
import { getCodeForOwner } from "./handoverCodes.js";
import { getUserContactsByIds } from "./ordersDb.js";
import { sendTemplate } from "./whatsapp.js";
import { getWhatsappRecipient } from "./whatsappDb.js";
import { getAgent, listAllAgents } from "./whatsappAgents.js";
import {
  agentJobCancelledMessage,
  agentNewJobMessage,
  agentOnTheWayMessage,
  cancellationDeclinedMessage,
  dispatchedMessage,
  orderBookedMessage,
  paymentFailedMessage,
  paymentReceivedMessage,
  pickupArea,
  pickupConfirmedMessage,
  repriceMessage,
  simpleStatusMessage,
  type WhatsappMessage,
} from "./whatsappTemplates.js";

/**
 * `{order}:{template}` unless the message says otherwise. See
 * migrations/create_whatsapp_messages.sql — this string is the entire
 * idempotency story.
 */
function dedupeKey(scope: string, message: WhatsappMessage): string {
  const base = `${scope}:${message.template}`;
  return message.dedupeSuffix ? `${base}:${message.dedupeSuffix}` : base;
}

/**
 * Send one built message to one person.
 *
 * Wrapped in a try so that a bug in this layer — not a provider failure, which
 * the transport already handles, but a genuine throw — still cannot reach the
 * caller. Everything above this line is a lifecycle handler that has already
 * committed a status change it cannot roll back.
 */
async function deliver(input: {
  message: WhatsappMessage;
  to: string | null;
  userId: string | null;
  orderId: string | null;
  scope: string;
}): Promise<void> {
  try {
    await sendTemplate({
      to: input.to,
      template: input.message.template,
      variables: input.message.variables,
      dedupeKey: dedupeKey(input.scope, input.message),
      orderId: input.orderId,
      userId: input.userId,
      otpButtonCode: input.message.otpButtonCode,
    });
  } catch (error) {
    console.error("[notify] send threw (swallowed)", {
      template: input.message.template,
      scope: input.scope,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The customer's own number, from their account. Never the address contact. */
async function customerPhone(userId: string): Promise<string | null> {
  const recipient = await getWhatsappRecipient(userId);
  return recipient?.phone ?? null;
}

async function agentName(agentId: string | null): Promise<string | null> {
  if (!agentId) return null;
  const contacts = await getUserContactsByIds([agentId]);
  return contacts.get(agentId)?.full_name ?? null;
}

// ── The status-change fan-out ─────────────────────────────────────────────

export interface OrderTransitionNotice {
  /** The order as it now stands, after the write. */
  order: Order;
  /** False for actions that do real work without moving the order. */
  moved: boolean;
  /** Who pressed the button. Null for system-driven changes. */
  actorUserId: string | null;
}

/**
 * Everything that must happen after an order changes hands.
 *
 * Call it with `void` — it is fire-and-forget by design, and awaiting it would
 * put a provider round trip in front of the customer's HTTP response.
 */
export async function notifyOrderTransition(notice: OrderTransitionNotice): Promise<void> {
  const { order, moved, actorUserId } = notice;
  if (!moved) return;

  await Promise.all([
    notifyCustomerInApp(order, actorUserId),
    notifyCustomerWhatsapp(order, actorUserId),
    notifyAgentOfDisruption(order),
  ]);
}

/**
 * The in-app half. Byte-for-byte what the inline block in `routes.ts` did —
 * same gates, same title, same body, same `data` shape. Changing it is out of
 * scope for the WhatsApp work; anything that reads differently here is a bug.
 */
async function notifyCustomerInApp(order: Order, actorUserId: string | null): Promise<void> {
  if (isInternalOnlyStatus(order.status)) return;
  // Nobody needs telling about something they just did themselves.
  if (order.user_id === actorUserId) return;

  await insertOrderStatusNotification({
    user_id: order.user_id,
    title: deriveCustomerStatus(order),
    body: `${order.order_no} — ${customerStatusDetail(order.status)}`,
    data: { order_id: order.id, order_no: order.order_no, status: order.status },
  });
}

async function notifyCustomerWhatsapp(order: Order, actorUserId: string | null): Promise<void> {
  if (order.user_id === actorUserId) return;

  const message = await buildCustomerMessage(order);
  if (!message) return;

  await deliver({
    message,
    to: await customerPhone(order.user_id),
    userId: order.user_id,
    orderId: order.id,
    scope: order.id,
  });
}

/**
 * Which message, if any, this status deserves on WhatsApp.
 *
 * Three statuses need more than the order row and are built individually; the
 * rest come from the catalogue's simple table. `weighed` is the one place this
 * diverges from `isInternalOnlyStatus`, and the reasoning is in
 * `repriceMessage`.
 */
async function buildCustomerMessage(order: Order): Promise<WhatsappMessage | null> {
  switch (order.status) {
    case "agent_accepted":
      return pickupConfirmedMessage({
        order,
        agentName: await agentName(order.agent_id),
      });

    case "out_for_pickup": {
      // The handover code, at the moment it starts to matter. `getCodeForOwner`
      // is called with the customer's own kind — they are the party who shows
      // this code, never the party who types it.
      const handover = await getCodeForOwner(order.id, "pickup");
      if (!handover) return null;
      return agentOnTheWayMessage({
        order,
        agentName: await agentName(order.agent_id),
        handoverCode: handover.code,
      });
    }

    case "weighed": {
      if (order.quoted_amount === null || order.final_amount === null) return null;
      return repriceMessage({
        order,
        quoted: order.quoted_amount,
        final: order.final_amount,
      });
    }

    case "dispatched":
      if (!order.awb_no) return null;
      return dispatchedMessage({ orderNo: order.order_no, awb: order.awb_no });

    default:
      return simpleStatusMessage(order);
  }
}

/**
 * The agent holding a job that has just been cancelled.
 *
 * Prevents the concrete failure this exists for: an agent riding to an address
 * for a parcel ops already stopped.
 */
async function notifyAgentOfDisruption(order: Order): Promise<void> {
  if (order.status !== "cancelled" || !order.agent_id) return;

  const agent = await getAgent(order.agent_id);
  if (!agent) return;

  await deliver({
    message: agentJobCancelledMessage({ order, cancelled: true }),
    to: agent.phone,
    userId: agent.id,
    orderId: order.id,
    scope: `${order.id}:agent`,
  });
}

// ── Individually triggered touchpoints ────────────────────────────────────

/**
 * Booking. Called directly rather than through `notifyOrderTransition`,
 * because the customer is the actor and the shared gate would suppress it —
 * and a booking confirmation is precisely the self-triggered message people
 * expect to receive.
 */
export async function notifyOrderBooked(input: {
  order: Order;
  customerName: string | null;
}): Promise<void> {
  await deliver({
    message: orderBookedMessage(input),
    to: await customerPhone(input.order.user_id),
    userId: input.order.user_id,
    orderId: input.order.id,
    scope: input.order.id,
  });
}

/**
 * A pickup has entered the pool.
 *
 * Fans out to every agent. It used to go only to those rostered for the booked
 * window; there is no window any more, so there is nothing to narrow it by —
 * a free job is one any agent can take.
 *
 * Each gets their own dedupe key, so the first one to claim it does not
 * suppress the others' messages — they were already sent — and a replayed
 * booking does not send anyone a second copy.
 */
export async function notifyAgentsOfNewJob(input: {
  order: Order;
  address: { city?: string | null; pincode?: string | null } | null;
}): Promise<void> {
  const { order } = input;
  if (order.pickup_request !== 1) return;

  const agents = await listAllAgents();
  if (agents.length === 0) return;

  const message = agentNewJobMessage({ order, area: pickupArea(input.address) });

  await Promise.all(
    agents.map((agent) =>
      deliver({
        message,
        to: agent.phone,
        userId: agent.id,
        orderId: order.id,
        scope: `${order.id}:agent:${agent.id}`,
      })
    )
  );
}

/**
 * Ops declined a cancellation.
 *
 * The one decision the customer must be told about explicitly. An approval
 * announces itself as the order turning `cancelled`, which the status fan-out
 * already covers; a decline changes nothing on screen, so without this the
 * customer waits forever.
 *
 * Owns both channels itself because the order does not move and
 * `notifyOrderTransition` would refuse it.
 */
export async function notifyCancellationDeclined(input: {
  order: Order;
  note: string | null;
}): Promise<void> {
  const { order, note } = input;

  await Promise.all([
    insertOrderStatusNotification({
      user_id: order.user_id,
      title: "Cancellation declined",
      body: note
        ? `${order.order_no} — ${note}`
        : `${order.order_no} — your cancellation request was declined. Your shipment is still going ahead.`,
      data: {
        order_id: order.id,
        order_no: order.order_no,
        status: order.status,
        cancellation: "rejected",
      },
    }),
    deliver({
      message: cancellationDeclinedMessage(input),
      to: await customerPhone(order.user_id),
      userId: order.user_id,
      orderId: order.id,
      scope: order.id,
    }),
  ]);
}

/**
 * The customer has asked to cancel a job an agent is already holding.
 *
 * The order deliberately does not move on a request — the agent is still
 * expected to collect until ops decides (`orderContract.ts` §Cancellation) —
 * so the message says wait, not stop.
 */
export async function notifyAgentOfCancellationRequest(order: Order): Promise<void> {
  if (!order.agent_id) return;

  const agent = await getAgent(order.agent_id);
  if (!agent) return;

  await deliver({
    message: agentJobCancelledMessage({ order, cancelled: false }),
    to: agent.phone,
    userId: agent.id,
    orderId: order.id,
    scope: `${order.id}:agent`,
  });
}

export async function notifyPaymentReceived(input: {
  order: Order;
  amount: number;
  txnId: string | null;
}): Promise<void> {
  await deliver({
    message: paymentReceivedMessage(input),
    to: await customerPhone(input.order.user_id),
    userId: input.order.user_id,
    orderId: input.order.id,
    scope: input.order.id,
  });
}

export async function notifyPaymentFailed(input: {
  order: Order;
  amount: number | null;
  /** Something unique per attempt — the gateway payment id. Failures repeat. */
  attemptRef: string;
}): Promise<void> {
  await deliver({
    message: paymentFailedMessage(input),
    to: await customerPhone(input.order.user_id),
    userId: input.order.user_id,
    orderId: input.order.id,
    scope: input.order.id,
  });
}

/**
 * The docket is registered and the parcel is trackable.
 *
 * Written from `persistShipment.ts`, which holds a shipment rather than an
 * order, so it passes the pieces rather than a row.
 */
export async function notifyDispatched(input: {
  userId: string;
  orderNo: string;
  awb: string;
  orderId: string | null;
}): Promise<void> {
  await deliver({
    message: dispatchedMessage({ orderNo: input.orderNo, awb: input.awb }),
    to: await customerPhone(input.userId),
    userId: input.userId,
    orderId: input.orderId,
    scope: input.orderId ?? `awb:${input.awb}`,
  });
}

/**
 * A regenerated pickup code.
 *
 * Only meaningful once the agent is on their way — before that the customer is
 * reading it off their own screen and nothing has gone wrong. The new code is
 * its own dedupe suffix, which is what makes this a different message from the
 * one carrying the code it replaced.
 */
export async function notifyHandoverCodeReissued(input: {
  order: Order;
  code: string;
}): Promise<void> {
  if (input.order.status !== "out_for_pickup") return;

  await deliver({
    message: agentOnTheWayMessage({
      order: input.order,
      agentName: await agentName(input.order.agent_id),
      handoverCode: input.code,
    }),
    to: await customerPhone(input.order.user_id),
    userId: input.order.user_id,
    orderId: input.order.id,
    scope: input.order.id,
  });
}

/** Exported for the scheduler, which builds its own messages per agent. */
export async function deliverToAgent(input: {
  message: WhatsappMessage;
  agentId: string;
  agentPhone: string | null;
  orderId: string | null;
  scope: string;
}): Promise<void> {
  await deliver({
    message: input.message,
    to: input.agentPhone,
    userId: input.agentId,
    orderId: input.orderId,
    scope: input.scope,
  });
}
