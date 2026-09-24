/**
 * A4 — recording gateway money.
 *
 * The counterpart of `agentDb.recordCollectedPayment`, which records money a
 * human took by hand. The difference that shapes this file is that a gateway
 * payment can arrive **twice**: once from the browser on the verify call, and
 * again from the webhook — and Razorpay retries webhooks, so "again" can mean
 * several times over several hours.
 *
 * So every write here is keyed on the Razorpay payment id in `reference`, and
 * recording the same id a second time is a no-op that returns the first row.
 * That is what makes the endpoints idempotent; the partial unique index in
 * migrations/payments_gateway_reference.sql is what makes it true under a
 * genuine race rather than merely usually true.
 */

import { supabase } from "./supabaseClient.js";
import { dbClient, logDbError, type DbError } from "./db/client.js";
import { toOrder, type OrderRow } from "./ordersDb.js";
import type { Order } from "../shared/orderContract.js";

const ORDER_COLUMNS =
  "id, order_no, user_id, status, pickup_request, pickup_date, origin_address_id, consignee, items, booked_weight, quoted_amount, packaging_required, payment_method, payment_status, is_cod, agent_id, actual_weight, final_amount, awb_no, metadata, created_at, updated_at";

/** Postgres unique_violation — the concurrent-writer signal, not an error. */
const UNIQUE_VIOLATION = "23505";

const logSupabaseError = (operation: string, error: DbError): void =>
  logDbError("paymentsDb", operation, error);

const getSupabaseClient = () => dbClient("paymentsDb");

export type GatewayPaymentRow = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  reference: string | null;
  txn_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const PAYMENT_COLUMNS =
  "id, order_id, amount, currency, status, reference, txn_id, metadata, created_at";

/**
 * Existing row for a Razorpay payment id, if we have already recorded it.
 *
 * Scoped to `method = 'pay_now'` because `reference` is shared ground: on a
 * cash row it holds a hand-written receipt number, and a receipt book that
 * starts at 1 would otherwise shadow a gateway id here. The unique index is
 * scoped the same way.
 */
export async function getPaymentByReference(
  reference: string
): Promise<GatewayPaymentRow | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("payments")
    .select(PAYMENT_COLUMNS)
    .eq("reference", reference)
    .eq("method", "pay_now")
    .maybeSingle();

  if (error) {
    logSupabaseError("getPaymentByReference", error);
    return null;
  }
  return (data as GatewayPaymentRow | null) ?? null;
}

export type GatewayPaymentInput = {
  order_id: string;
  /** Null on a guest booking; `guest_ref` names the payer instead. */
  user_id: string | null;
  guest_ref?: string | null;
  /** Rupees, as everywhere on our side of the wire. */
  amount: number;
  currency: string;
  /** The Razorpay payment id — `pay_...`. The idempotency key. */
  reference: string;
  metadata: Record<string, unknown>;
};

export type RecordGatewayPaymentResult = {
  payment: GatewayPaymentRow;
  /** False when this id had already been recorded — the caller must not re-notify. */
  created: boolean;
  order: Order | null;
};

/**
 * Record a captured gateway payment and move `orders.payment_status`.
 *
 * Two writes that ought to be one transaction, in the same fails-safe order
 * `agentDb.recordCollectedPayment` uses and for the same reason: the money row
 * first, the flag second. A crash between them leaves a recorded payment on an
 * order still marked pending — findable and fixable. The reverse would mark an
 * order paid with nothing recording the money.
 *
 * `collected_by` and `collection_mode` stay null: nobody collected this by
 * hand, which is exactly what those columns mean (see create_payments.sql).
 */
export async function recordGatewayPayment(
  input: GatewayPaymentInput
): Promise<RecordGatewayPaymentResult | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const existing = await getPaymentByReference(input.reference);
  if (existing) {
    // Already recorded — by the verify call, or by an earlier delivery of this
    // same webhook. Still reconcile the order flag, because the crash window
    // above may have left it stale.
    const order = await reconcilePaymentStatus(input.order_id);
    return { payment: existing, created: false, order };
  }

  const { data, error } = await client
    .from("payments")
    .insert({
      order_id: input.order_id,
      user_id: input.user_id,
      guest_ref: input.guest_ref ?? null,
      amount: input.amount,
      currency: input.currency,
      method: "pay_now",
      status: "collected",
      reference: input.reference,
      metadata: input.metadata,
      collected_at: new Date().toISOString(),
    })
    .select(PAYMENT_COLUMNS)
    .single();

  if (error) {
    // The verify call and the webhook landing in the same instant. The index
    // resolved it; whoever lost re-reads the winner's row.
    if (error.code === UNIQUE_VIOLATION) {
      const winner = await getPaymentByReference(input.reference);
      if (winner) {
        const order = await reconcilePaymentStatus(input.order_id);
        return { payment: winner, created: false, order };
      }
    }
    logSupabaseError("recordGatewayPayment:insert", error);
    return null;
  }

  const order = await reconcilePaymentStatus(input.order_id);
  return { payment: data as GatewayPaymentRow, created: true, order };
}

/** Half a paisa: amounts are rupees with two decimals, compared with tolerance. */
const PAISA_TOLERANCE = 0.005;

/**
 * What `orders.payment_status` should read, from the money actually held.
 *
 * Pure, so the rules can be tested without a database:
 *
 *   · COD never changes here — nothing is collected by us, and it must never
 *     block a docket.
 *   · A cancelled order holding money owes it back: `refund_due`.
 *   · Otherwise compare what we hold with what is due now — `final_amount`
 *     once the hub has weighed the parcel, the booking quote before that:
 *     nothing held → `pending`, short → `partially_paid`, more than due →
 *     `refund_due` (Flow D, weighed lighter), covered → `paid`.
 *   · No amount due on record → whatever was collected is taken as covering
 *     it; an order with no quote is a data problem, not a reason to show money
 *     as uncollected.
 *
 * Returns null for "leave it as it is".
 */
export function derivePaymentStatus(input: {
  status: string;
  paymentMethod: string;
  isCod: boolean;
  due: number | null;
  held: number;
  current: string | null;
}): Order["payment_status"] | null {
  if (input.isCod || input.paymentMethod === "cod") return null;
  if (input.status === "cancelled") return input.held > PAISA_TOLERANCE ? "refund_due" : null;
  if (input.held <= PAISA_TOLERANCE) {
    // A failed gateway attempt is more informative than "pending"; keep it.
    return input.current === "failed" ? null : "pending";
  }
  if (input.due == null) return "paid";
  if (input.held + PAISA_TOLERANCE < input.due) return "partially_paid";
  if (input.held > input.due + PAISA_TOLERANCE) return "refund_due";
  return "paid";
}

/**
 * Recompute an order's payment flag from its payments and its amount due, and
 * write it. The single writer of `payment_status` for every money event:
 * a door or counter collection, a gateway payment, a reweigh at the hub, and
 * a cancellation.
 *
 * It replaced per-caller flips that each looked at one number: any collection
 * marked the order `paid` whatever the amount, and a reweigh never touched the
 * flag, so a prepaid parcel that turned out heavier settled short and one that
 * turned out lighter never showed a refund.
 *
 * Money held is the sum of `collected` payment rows, less anything refunded
 * through the dashboard. Once a dashboard refund has been recorded the order
 * keeps its `refund_due` flag for accounts to close by hand — recomputing it
 * would quietly un-flag money that has already moved.
 *
 * Races: every caller recomputes from the rows, so whichever write lands last
 * is also the most informed one.
 */
export async function reconcilePaymentStatus(orderId: string): Promise<Order | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data: order, error: orderError } = await client
    .from("orders")
    .select("status, payment_method, is_cod, payment_status, quoted_amount, final_amount")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !order) {
    if (orderError) logSupabaseError("reconcilePaymentStatus:order", orderError);
    return null;
  }

  const { data: rows, error: paymentsError } = await client
    .from("payments")
    .select("amount, status, metadata")
    .eq("order_id", orderId);
  if (paymentsError) {
    logSupabaseError("reconcilePaymentStatus:payments", paymentsError);
    return null;
  }

  let held = 0;
  let refundRecorded = false;
  for (const p of rows ?? []) {
    const refunded = Number((p.metadata as Record<string, unknown> | null)?.amount_refunded) || 0;
    if (refunded > 0) refundRecorded = true;
    if (p.status === "collected") held += (Number(p.amount) || 0) - refunded;
  }

  if (refundRecorded && order.payment_status === "refund_due") return null;

  const num = (v: unknown) => (v == null ? null : Number(v));
  const next = derivePaymentStatus({
    status: order.status as string,
    paymentMethod: order.payment_method as string,
    isCod: !!order.is_cod,
    due: num(order.final_amount) ?? num(order.quoted_amount),
    held,
    current: (order.payment_status as string | null) ?? null,
  });
  if (next === null || next === order.payment_status) {
    const { data } = await client.from("orders").select(ORDER_COLUMNS).eq("id", orderId).maybeSingle();
    return data ? toOrder(data as unknown as OrderRow) : null;
  }

  const { data, error } = await client
    .from("orders")
    .update({ payment_status: next, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .select(ORDER_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(
      "[paymentsDb] payment recorded but orders.payment_status not updated — reconcile manually:",
      { order_id: orderId, error: error.message }
    );
    return null;
  }

  return data ? toOrder(data as unknown as OrderRow) : null;
}


// ── Refunds ───────────────────────────────────────────────────────────────
//
// We do not *process* refunds this phase — that decision is recorded in
// day-zero-checklist.md: manual, with a flag, because gateway refunds bring
// reconciliation work there is no room for. Accounts moves the money by hand.
//
// What follows exists for the other direction: somebody issues a refund in the
// Razorpay dashboard, and without this the order would go on reading `paid`
// forever. This records that it happened. It never initiates one.

type RefundNote = {
  refund_id: string;
  amount: number;
  currency: string;
  event: string;
  at: string;
};

export type RecordRefundResult = {
  /** False when this refund id was already on the row — a retried webhook. */
  recorded: boolean;
  orderId: string;
  /** What the payment row holds — unchanged by refunds, by design. */
  collectedAmount: number;
  /** Cumulative refunded amount across every refund on this payment. */
  totalRefunded: number;
  /** True once the refunds cover what we collected. */
  fullyRefunded: boolean;
};

/**
 * Record a processed gateway refund against the payment it reverses.
 *
 * The `payments` row keeps its original `amount` — that is what we collected,
 * and rewriting it would destroy the ledger. What changes is `status` (once the
 * refunds cover the row) and `metadata.refunds`, which accumulates one note per
 * refund. `orders.payment_status` goes to `refund_due`, which is the flag a
 * human acts on.
 *
 * Idempotent on the refund id: Razorpay retries refund webhooks like any other,
 * and a partial refund seen twice must not count twice.
 *
 * ACCEPTED RACE: two refund deliveries for the *same payment but different
 * refund ids*, arriving inside each other's read-modify-write of `metadata`,
 * can lose one note. supabase-js cannot express an atomic jsonb append, and
 * Razorpay spaces its retries — so the exposure is two distinct partial refunds
 * on one payment within milliseconds of each other, which needs the money
 * reconciled by hand regardless. Promote to a Postgres function if refunds ever
 * stop being manual.
 */
export async function recordRefund(input: {
  /** Razorpay refund id — `rfnd_...`. The idempotency key. */
  refundId: string;
  /** Razorpay payment id the refund reverses — our `payments.reference`. */
  paymentReference: string;
  /** Rupees returned by *this* refund, not the cumulative total. */
  amount: number;
  currency: string;
  event: string;
}): Promise<RecordRefundResult | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const payment = await getPaymentByReference(input.paymentReference);
  if (!payment) return null;

  const metadata = payment.metadata ?? {};
  const priorRefunds: RefundNote[] = Array.isArray(metadata.refunds)
    ? (metadata.refunds as RefundNote[])
    : [];

  const already = priorRefunds.some((r) => r?.refund_id === input.refundId);
  const refunds = already
    ? priorRefunds
    : [
        ...priorRefunds,
        {
          refund_id: input.refundId,
          amount: input.amount,
          currency: input.currency,
          event: input.event,
          at: new Date().toISOString(),
        },
      ];

  const totalRefunded = refunds.reduce((sum, r) => sum + (Number(r?.amount) || 0), 0);
  // Float tolerance, same as the paid check: ₹0.005 either way is rounding.
  const fullyRefunded = totalRefunded + 0.005 >= Number(payment.amount);

  if (!already) {
    const { error } = await client
      .from("payments")
      .update({
        // Partial refunds keep `collected` — we are still holding most of it.
        // Only a full reversal makes the row `refunded`.
        status: fullyRefunded ? "refunded" : payment.status,
        metadata: { ...metadata, refunds, amount_refunded: totalRefunded },
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.id);

    if (error) {
      logSupabaseError("recordRefund:payment", error);
      return null;
    }
  }

  // The flag, every time — including on a retry, because the payment row and
  // the order flag are two writes and the first run may have died between them.
  const { error: orderError } = await client
    .from("orders")
    .update({ payment_status: "refund_due", updated_at: new Date().toISOString() })
    .eq("id", payment.order_id)
    .neq("payment_status", "refund_due");

  if (orderError) {
    console.error(
      "[paymentsDb] refund recorded but orders.payment_status not flagged — reconcile manually:",
      { order_id: payment.order_id, refund_id: input.refundId, error: orderError.message }
    );
  }

  return {
    recorded: !already,
    orderId: payment.order_id,
    collectedAmount: Number(payment.amount),
    totalRefunded,
    fullyRefunded,
  };
}

/**
 * Note a failed refund on the order.
 *
 * Separate from `recordFailedAttempt` because that one refuses to write to a
 * paid order — correct for a failed payment, wrong here: a refund that fails is
 * *always* on an order somebody already paid, and that is exactly the case
 * accounts needs told about.
 */
export async function recordFailedRefund(
  paymentReference: string,
  detail: Record<string, unknown>
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const payment = await getPaymentByReference(paymentReference);
  if (!payment) return false;

  const { data, error: readError } = await client
    .from("orders")
    .select("metadata")
    .eq("id", payment.order_id)
    .maybeSingle();

  if (readError) {
    logSupabaseError("recordFailedRefund:read", readError);
    return false;
  }

  const metadata = {
    ...((data?.metadata as Record<string, unknown> | null) ?? {}),
    last_refund_failure: { ...detail, at: new Date().toISOString() },
  };

  const { error } = await client
    .from("orders")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", payment.order_id);

  if (error) {
    logSupabaseError("recordFailedRefund:update", error);
    return false;
  }
  return true;
}

/**
 * Note a failed attempt on the order without touching `payments`.
 *
 * A failed payment is not money, so it gets no row — `payments` is a ledger of
 * what we hold. But the customer needs to see *something* changed, and support
 * needs the gateway id to look it up, so it goes in `orders.metadata` under a
 * single key that later attempts overwrite.
 */
export async function recordFailedAttempt(
  orderId: string,
  detail: Record<string, unknown>
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const { data, error: readError } = await client
    .from("orders")
    .select("metadata")
    .eq("id", orderId)
    .maybeSingle();

  if (readError) {
    logSupabaseError("recordFailedAttempt:read", readError);
    return;
  }

  const metadata = {
    ...((data?.metadata as Record<string, unknown> | null) ?? {}),
    last_payment_failure: { ...detail, at: new Date().toISOString() },
  };

  const { error } = await client
    .from("orders")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    // Never overwrite a paid flag with a failure from a stale retry.
    .neq("payment_status", "paid");

  if (error) logSupabaseError("recordFailedAttempt:update", error);
}

/**
 * Remember which gateway order belongs to this order, so the verify call can
 * check that the browser is quoting the order we actually created.
 *
 * Lives in `orders.metadata` rather than a column: it is A4-internal, has no
 * reader outside this lane, and adding a column to the shared `orders`
 * contract for it would put it in every other module's face.
 */
export async function attachRazorpayOrderId(
  orderId: string,
  razorpayOrderId: string
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const { data, error: readError } = await client
    .from("orders")
    .select("metadata")
    .eq("id", orderId)
    .maybeSingle();

  if (readError) {
    logSupabaseError("attachRazorpayOrderId:read", readError);
    return;
  }

  const prior = (data?.metadata as Record<string, unknown> | null) ?? {};
  const priorIds = Array.isArray(prior.razorpay_order_ids)
    ? (prior.razorpay_order_ids as string[])
    : [];

  const metadata = {
    ...prior,
    razorpay_order_id: razorpayOrderId,
    // A customer who dismisses the modal and retries generates a second
    // gateway order. Keep the trail — support gets asked about the id the
    // customer saw, which may not be the latest one.
    razorpay_order_ids: priorIds.includes(razorpayOrderId)
      ? priorIds
      : [...priorIds, razorpayOrderId].slice(-10),
  };

  const { error } = await client
    .from("orders")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", orderId);

  if (error) logSupabaseError("attachRazorpayOrderId:update", error);
}

/** The gateway order ids we have opened for this order, newest last. */
export function readRazorpayOrderIds(order: Order): string[] {
  const meta = order.metadata ?? {};
  const ids = (meta as Record<string, unknown>).razorpay_order_ids;
  return Array.isArray(ids) ? (ids as string[]) : [];
}
