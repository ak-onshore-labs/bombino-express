/**
 * A4 — Payments (Razorpay).
 *
 * Self-registering: `registerPaymentRoutes(app)` is called from `routes.ts`,
 * same shape as `routes/agent.ts`.
 *
 * Three endpoints, and they trust each other in a specific order:
 *
 *   POST /order   opens a gateway order for a `pay_now` order the caller owns
 *   POST /verify  the browser returns from the checkout modal with a signature
 *   POST /webhook Razorpay tells us directly, and keeps telling us until 2xx
 *
 * Plus two that are not part of that chain: `GET /config`, which tells the
 * client what it may offer, and `POST /test/settle`, a temporary bypass that
 * settles a pay-now order without the gateway while the Razorpay account is
 * unusable. It is off unless `PAYMENTS_TEST_MODE=1` — see
 * server/paymentsTestMode.ts, and delete both when the gateway works.
 *
 * `verify` exists for the customer's benefit — it turns the modal closing into
 * a paid order they can see immediately. The **webhook is the authority**: a
 * customer whose browser dies between paying and returning must still end up
 * with a paid order, and they do, because the webhook is not part of their
 * session. Both paths write through `recordGatewayPayment`, which is keyed on
 * the Razorpay payment id, so whichever arrives second changes nothing.
 *
 * Money is never taken on the client's word. The verify path re-reads the
 * payment from Razorpay's API and uses **that** amount, not the amount the
 * browser sent — the checkout signature covers the ids only.
 *
 * **Refunds are not issued here, ever.** They are manual this phase by
 * decision (day-zero-checklist.md) — accounts moves the money. The webhook
 * listens for `refund.processed` only so that when they do, the order stops
 * reading `paid` and gets flagged `refund_due` for a human.
 *
 * Nothing here ever touches ITD. No payment field is sent there, in any
 * direction (§ A4).
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { notifyPaymentFailed, notifyPaymentReceived } from "../notify.js";
import { ensureDbUser, requireUserOrGuest } from "../routeGuards.js";
import { getOrderById, getUserContactsByIds, insertOrderEvent } from "../ordersDb.js";
import {
  attachRazorpayOrderId,
  readRazorpayOrderIds,
  recordFailedAttempt,
  recordFailedRefund,
  recordGatewayPayment,
  recordRefund,
} from "../paymentsDb.js";
import {
  captureRazorpayPayment,
  createRazorpayOrder,
  fetchRazorpayPayment,
  getRazorpayConfig,
  isRazorpayConfigured,
  toRupees,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "../razorpay.js";
import { isPaymentsTestModeEnabled } from "../paymentsTestMode.js";
import type { Order } from "../../shared/orderContract.js";

/** The amount we are currently asking for. Reprice at the hub can move it. */
function amountDue(order: Order): number | null {
  const due = order.final_amount ?? order.quoted_amount;
  return typeof due === "number" && due > 0 ? due : null;
}

/**
 * Everything that must be true before we open a gateway order or accept one
 * back. Shared by `/order` and `/verify` so the two cannot drift — a check
 * that only guards order creation is not a check at all.
 */
/**
 * Who is asking to pay: an account, or a guest holding a verified phone.
 *
 * A guest booking has no session user — that is the whole point of it — so
 * ownership is proved by the same ref their documents and their order were
 * written under. It lives in the session and is minted by the OTP step, so a
 * caller cannot name someone else's ref without first verifying that number.
 */
export type PaymentCaller = { userId: string; guestRef: null } | { userId: null; guestRef: string };

export function paymentCallerFrom(req: {
  session: { dbUserId?: string; guestRef?: string };
}): PaymentCaller | null {
  if (req.session.dbUserId) return { userId: req.session.dbUserId, guestRef: null };
  if (req.session.guestRef) return { userId: null, guestRef: req.session.guestRef };
  return null;
}

/** Does this order belong to the caller? */
function ownsOrder(order: Order, caller: PaymentCaller): boolean {
  return caller.userId !== null
    ? order.user_id === caller.userId
    : order.guest_ref === caller.guestRef;
}

async function loadPayableOrder(
  orderId: string,
  caller: PaymentCaller
): Promise<
  | { ok: true; order: Order }
  | { ok: false; status: number; message: string; code: string }
> {
  const order = await getOrderById(orderId);

  // Not-yours and not-found are the same answer on purpose: order ids are
  // guessable enough that distinguishing them would confirm existence.
  if (!order || !ownsOrder(order, caller)) {
    return { ok: false, status: 404, message: "Order not found", code: "ORDER_NOT_FOUND" };
  }

  if (order.payment_method !== "pay_now") {
    return {
      ok: false,
      status: 400,
      message: "This order is not marked pay-now.",
      code: "PAYMENT_METHOD_MISMATCH",
    };
  }

  if (order.status === "cancelled") {
    return {
      ok: false,
      status: 409,
      message: "This order has been cancelled.",
      code: "ORDER_CANCELLED",
    };
  }

  return { ok: true, order };
}

export function registerPaymentRoutes(app: Express): void {
  // ── GET /api/payments/config ────────────────────────────────────────────
  //
  // What the client may offer, decided here rather than guessed there. Two
  // booleans and no secrets: the key id is only handed out by `/order`, which
  // has already checked the order is payable.
  // Guests too: they are the callers most likely to be asking, having just
  // booked without an account. `requireUser` here 401'd every guest, and the
  // client's session interceptor read that 401 as an expired session and signed
  // them out mid-payment.
  app.get("/api/payments/config", requireUserOrGuest, (_req: Request, res: Response) => {
    res.json({
      gateway_configured: isRazorpayConfigured(),
      test_mode: isPaymentsTestModeEnabled(),
    });
  });

  // ── POST /api/payments/test/settle ──────────────────────────────────────
  //
  // TEMPORARY (see server/paymentsTestMode.ts). Marks a pay-now order paid
  // without the gateway, so the flows behind a paid order can be tested while
  // the Razorpay account is unusable.
  //
  // Same guards as the real thing — session, ownership, pay-now, not cancelled,
  // not already paid — because a bypass with weaker checks is a bypass someone
  // finds. What it skips is only the money.
  app.post(
    "/api/payments/test/settle",
    requireUserOrGuest,
    ensureDbUser,
    async (req: Request, res: Response) => {
      // 404, not 403: an endpoint that is off should not confirm it exists.
      if (!isPaymentsTestModeEnabled()) {
        res.status(404).json({ message: "Not found", code: "TEST_MODE_DISABLED" });
        return;
      }

      const caller = paymentCallerFrom(req);
      if (!caller) {
        res.status(401).json({ message: "Login required" });
        return;
      }

      const parsed = z
        .object({ order_id: z.string().uuid("order_id must be a valid id") })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
          code: "INVALID_REQUEST",
        });
        return;
      }

      const loaded = await loadPayableOrder(parsed.data.order_id, caller);
      if (!loaded.ok) {
        res.status(loaded.status).json({ message: loaded.message, code: loaded.code });
        return;
      }
      const { order } = loaded;

      if (order.payment_status === "paid") {
        res.status(409).json({ message: "This order is already paid.", code: "ALREADY_PAID" });
        return;
      }

      const due = amountDue(order);
      if (due == null) {
        res.status(409).json({
          message: "This order has no amount to pay yet.",
          code: "NO_AMOUNT_DUE",
        });
        return;
      }

      // Deterministic reference, so a double tap records one payment: it is the
      // idempotency key `recordGatewayPayment` dedupes on. The `test_` prefix is
      // how these are told apart from `pay_...` gateway ids in the ledger.
      const reference = `test_${order.id}`;

      console.warn("[payments] TEST MODE settle — no money moved:", {
        order_id: order.id,
        order_no: order.order_no,
        amount: due,
      });

      const recorded = await recordGatewayPayment({
        order_id: order.id,
        user_id: order.user_id,
        guest_ref: order.guest_ref ?? null,
        amount: due,
        currency: "INR",
        reference,
        metadata: { source: "test_mode", gateway: null, note: "PAYMENTS_TEST_MODE — no gateway" },
      });

      if (!recorded) {
        res.status(502).json({
          message: "Could not record the test payment.",
          code: "PAYMENT_WRITE_FAILED",
        });
        return;
      }

      if (recorded.created) {
        void insertOrderEvent({
          order_id: order.id,
          // Not a status move — paying does not advance the parcel.
          status: order.status,
          note: `Paid ₹${due} in test mode (no gateway)`,
          actor_user_id: order.user_id,
          metadata: { payment_id: recorded.payment.id, reference, source: "test_mode" },
        });
      }

      res.json({
        paid: true,
        payment_status: recorded.order?.payment_status ?? "paid",
        amount: due,
        reference,
        txn_id: recorded.payment.txn_id,
        test_mode: true,
      });
    }
  );

  // ── POST /api/payments/razorpay/order ───────────────────────────────────
  //
  // Opens a gateway order for the checkout modal. Idempotency is not needed
  // here: an abandoned gateway order costs nothing and expires on its own, so
  // a customer who dismisses the modal and taps Pay again simply gets a fresh
  // one. Every id we open is kept on the order so `/verify` can refuse a
  // gateway order we never created.
  app.post(
    "/api/payments/razorpay/order",
    requireUserOrGuest,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const caller = paymentCallerFrom(req);
      if (!caller) {
        res.status(401).json({ message: "Login required" });
        return;
      }

      const config = getRazorpayConfig();
      if (!config) {
        res.status(503).json({
          message: "Online payment is temporarily unavailable. Choose another payment method.",
          code: "GATEWAY_UNCONFIGURED",
        });
        return;
      }

      const parsed = z
        .object({ order_id: z.string().uuid("order_id must be a valid id") })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
          code: "INVALID_REQUEST",
        });
        return;
      }

      const loaded = await loadPayableOrder(parsed.data.order_id, caller);
      if (!loaded.ok) {
        res.status(loaded.status).json({ message: loaded.message, code: loaded.code });
        return;
      }
      const { order } = loaded;

      if (order.payment_status === "paid") {
        res.status(409).json({
          message: "This order is already paid.",
          code: "ALREADY_PAID",
        });
        return;
      }

      const due = amountDue(order);
      if (due == null) {
        res.status(409).json({
          message: "This order has no amount to pay yet.",
          code: "NO_AMOUNT_DUE",
        });
        return;
      }

      const created = await createRazorpayOrder({
        amountRupees: due,
        currency: "INR",
        receipt: order.order_no,
        // The webhook has no session. These notes are how it finds its way
        // back to our order — do not remove them.
        notes: {
          order_id: order.id,
          order_no: order.order_no,
          // One of these is always set. The webhook keys off order_id; these
          // are for reading a payment in Razorpay's dashboard and knowing who
          // it belongs to.
          user_id: order.user_id ?? "",
          guest_ref: order.guest_ref ?? "",
        },
      });

      if (!created.ok) {
        res.status(502).json({
          message: "Could not start the payment. Please try again.",
          code: "GATEWAY_ERROR",
        });
        return;
      }

      await attachRazorpayOrderId(order.id, created.order.id);

      // Prefill saves the customer retyping what we already hold. Best-effort:
      // a missing contact is a worse checkout, not a failed one.
      //
      // A guest has no account row to read, but the booking itself carries the
      // name and the verified number they gave minutes ago, which is exactly
      // what the prefill wants.
      const contact = order.user_id
        ? (await getUserContactsByIds([order.user_id])).get(order.user_id)
        : {
            full_name: order.guest_name ?? null,
            phone: order.guest_phone ?? null,
            email: order.guest_email ?? null,
          };

      res.json({
        key_id: config.keyId,
        razorpay_order_id: created.order.id,
        amount: created.order.amount, // paise — what Checkout expects
        currency: created.order.currency,
        order_no: order.order_no,
        prefill: {
          name: contact?.full_name ?? "",
          contact: contact?.phone ?? "",
        },
      });
    }
  );

  // ── POST /api/payments/razorpay/verify ──────────────────────────────────
  //
  // The browser's return path. Success here is a convenience — the webhook
  // would have recorded the same payment anyway — so every failure below is
  // safe to report honestly to the customer.
  app.post(
    "/api/payments/razorpay/verify",
    requireUserOrGuest,
    ensureDbUser,
    async (req: Request, res: Response) => {
      const caller = paymentCallerFrom(req);
      if (!caller) {
        res.status(401).json({ message: "Login required" });
        return;
      }

      if (!isRazorpayConfigured()) {
        res.status(503).json({ message: "Online payment is unavailable.", code: "GATEWAY_UNCONFIGURED" });
        return;
      }

      const parsed = z
        .object({
          order_id: z.string().uuid(),
          razorpay_order_id: z.string().trim().min(1),
          razorpay_payment_id: z.string().trim().min(1),
          razorpay_signature: z.string().trim().min(1),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
          code: "INVALID_REQUEST",
        });
        return;
      }
      const body = parsed.data;

      const loaded = await loadPayableOrder(body.order_id, caller);
      if (!loaded.ok) {
        res.status(loaded.status).json({ message: loaded.message, code: loaded.code });
        return;
      }
      const { order } = loaded;

      // The signature proves Razorpay minted this pair. It does not prove the
      // pair belongs to *this* order — so check the gateway order against the
      // ids we opened, or a customer could settle one order with another's
      // payment.
      if (!readRazorpayOrderIds(order).includes(body.razorpay_order_id)) {
        res.status(400).json({
          message: "This payment does not belong to this order.",
          code: "ORDER_MISMATCH",
        });
        return;
      }

      if (
        !verifyCheckoutSignature({
          razorpayOrderId: body.razorpay_order_id,
          razorpayPaymentId: body.razorpay_payment_id,
          signature: body.razorpay_signature,
        })
      ) {
        console.error("[payments] checkout signature mismatch", {
          order_id: order.id,
          razorpay_order_id: body.razorpay_order_id,
        });
        res.status(400).json({
          message: "We could not verify that payment.",
          code: "SIGNATURE_MISMATCH",
        });
        return;
      }

      const fetched = await fetchRazorpayPayment(body.razorpay_payment_id);
      if (!fetched.ok) {
        // The webhook will still land. Tell the customer the truth rather than
        // guessing at a state we could not read.
        res.status(202).json({
          message: "Payment received — we are confirming it. This can take a moment.",
          code: "CONFIRMATION_PENDING",
        });
        return;
      }

      let payment = fetched.payment;

      if (payment.order_id && payment.order_id !== body.razorpay_order_id) {
        res.status(400).json({
          message: "This payment does not belong to this order.",
          code: "ORDER_MISMATCH",
        });
        return;
      }

      if (payment.status === "failed") {
        await recordFailedAttempt(order.id, {
          razorpay_payment_id: payment.id,
          reason: payment.error_description ?? null,
        });
        // Keyed on the payment id, so a customer who fails three times is told
        // three times. A silent second failure reads as a first success.
        void notifyPaymentFailed({
          order,
          amount: toRupees(payment.amount),
          attemptRef: payment.id,
        });
        res.status(402).json({
          message: payment.error_description ?? "That payment did not go through.",
          code: "PAYMENT_FAILED",
        });
        return;
      }

      // Authorised but not captured — accounts with auto-capture off. The money
      // is held, not taken; leaving it would expire the authorisation and the
      // customer would see a charge reversed days later for no reason.
      if (payment.status === "authorized") {
        const captured = await captureRazorpayPayment(
          payment.id,
          toRupees(payment.amount),
          payment.currency
        );
        if (captured.ok) payment = captured.payment;
      }

      if (payment.status !== "captured" && payment.status !== "authorized") {
        res.status(202).json({
          message: "Payment is still processing. We will update the order when it clears.",
          code: "CONFIRMATION_PENDING",
        });
        return;
      }

      const recorded = await recordGatewayPayment({
        order_id: order.id,
        user_id: order.user_id,
        guest_ref: order.guest_ref ?? null,
        // Razorpay's number, not the browser's.
        amount: toRupees(payment.amount),
        currency: payment.currency,
        reference: payment.id,
        metadata: {
          source: "verify",
          razorpay_order_id: body.razorpay_order_id,
          razorpay_payment_id: payment.id,
          method: payment.method ?? null,
        },
      });

      if (!recorded) {
        // Money moved and we failed to write it. Loud, because reconciliation
        // has to find this by hand — the webhook retry is the safety net.
        console.error("[payments] captured payment could not be recorded:", {
          order_id: order.id,
          razorpay_payment_id: payment.id,
        });
        res.status(502).json({
          message: "Payment went through but we could not record it. Support has been notified.",
          code: "PAYMENT_WRITE_FAILED",
        });
        return;
      }

      if (recorded.created) {
        void insertOrderEvent({
          order_id: order.id,
          // Not a status move — paying does not advance the parcel.
          status: order.status,
          note: `Paid ₹${toRupees(payment.amount)} online`,
          actor_user_id: order.user_id,
          metadata: { payment_id: recorded.payment.id, reference: payment.id, source: "verify" },
        });

        // Receipt on WhatsApp. Gated on `created` like the event above, so the
        // webhook racing this call cannot send a second copy — that race is
        // designed in (payments_gateway_reference.sql) and exactly one of the
        // two writers wins it.
        void notifyPaymentReceived({
          order,
          amount: toRupees(payment.amount),
          txnId: recorded.payment.txn_id,
        });
      }

      res.json({
        paid: true,
        payment_status: recorded.order?.payment_status ?? "paid",
        amount: toRupees(payment.amount),
        reference: payment.id,
        txn_id: recorded.payment.txn_id,
      });
    }
  );

  // ── POST /api/payments/razorpay/webhook ─────────────────────────────────
  //
  // No session, no `requireUser` — the caller is Razorpay, and the signature
  // over the raw body is the entire authentication. `server/index.ts` stashes
  // that buffer on `req.rawBody`; a re-serialised body would not verify.
  //
  // Status codes here are instructions to Razorpay's retry queue, not messages
  // to a person. 2xx means "stop sending this"; anything else means "send it
  // again". So a payload we understood but could not act on returns 500 to
  // earn a retry, while a payload we can never act on returns 200 — retrying
  // it forever would only bury the real failures.
  app.post("/api/payments/razorpay/webhook", async (req: Request, res: Response) => {
    const signature = req.header("x-razorpay-signature");
    const raw = req.rawBody;

    if (!signature || !(raw instanceof Buffer)) {
      res.status(400).json({ message: "Missing signature" });
      return;
    }

    if (!verifyWebhookSignature(raw, signature)) {
      // Either someone is guessing, or RAZORPAY_WEBHOOK_SECRET does not match
      // the dashboard. Both look identical from here and both need a human.
      console.error("[payments] webhook signature rejected");
      res.status(401).json({ message: "Invalid signature" });
      return;
    }

    const event = (req.body ?? {}) as {
      event?: string;
      payload?: {
        payment?: { entity?: Record<string, unknown> };
        refund?: { entity?: Record<string, unknown> };
      };
    };
    const entity = event.payload?.payment?.entity;
    const eventName = event.event ?? "";

    // ── Refunds ───────────────────────────────────────────────────────────
    //
    // We never initiate one — refunds are manual this phase, by decision, and
    // accounts moves the money outside the system. This branch is here so that
    // when they do, the order stops claiming to be paid. Without it a
    // dashboard refund leaves our ledger quietly wrong.
    if (eventName.startsWith("refund.")) {
      const refund = event.payload?.refund?.entity;
      const paymentReference =
        typeof refund?.payment_id === "string" ? refund.payment_id : null;

      if (!refund || typeof refund.id !== "string" || !paymentReference) {
        console.error("[payments] refund webhook missing ids:", { event: eventName });
        res.json({ received: true, ignored: "malformed_refund" });
        return;
      }

      if (eventName === "refund.failed") {
        await recordFailedRefund(paymentReference, {
          refund_id: refund.id,
          reason: typeof refund.notes === "object" ? refund.notes : null,
          source: "webhook",
        });
        res.json({ received: true });
        return;
      }

      // `refund.created` and `refund.speed_changed` are intent, not movement.
      // Only `processed` means the customer's money actually went back.
      if (eventName !== "refund.processed") {
        res.json({ received: true, ignored: eventName });
        return;
      }

      const refundAmount = typeof refund.amount === "number" ? toRupees(refund.amount) : null;
      if (refundAmount == null || refundAmount <= 0) {
        console.error("[payments] refund webhook has no usable amount:", { refund_id: refund.id });
        res.json({ received: true, ignored: "no_amount" });
        return;
      }

      const result = await recordRefund({
        refundId: refund.id,
        paymentReference,
        amount: refundAmount,
        currency: typeof refund.currency === "string" ? refund.currency : "INR",
        event: eventName,
      });

      if (!result) {
        // Either the payment was never recorded on our side, or the write
        // failed. Both are worth a retry: refund webhooks retry for hours, and
        // a payment we failed to record may land in that window.
        console.error("[payments] could not record refund — asking for a retry:", {
          event: eventName,
          refund_id: refund.id,
          razorpay_payment_id: paymentReference,
        });
        res.status(500).json({ message: "Could not record refund" });
        return;
      }

      // Only the delivery that actually recorded the refund writes an event,
      // so retries do not stack duplicates in the customer's timeline.
      if (result.recorded) {
        const refundedOrder = await getOrderById(result.orderId);
        if (refundedOrder) {
          void insertOrderEvent({
            order_id: result.orderId,
            // Not a status move — a refund does not un-ship a parcel.
            status: refundedOrder.status,
            note: result.fullyRefunded
              ? `Refunded ₹${result.totalRefunded} in full`
              : `Refunded ₹${refundAmount} of ₹${result.collectedAmount} collected`,
            // Nobody in our system did this — it happened in the Razorpay
            // dashboard, so there is no actor id to record.
            actor_user_id: null,
            metadata: {
              refund_id: refund.id,
              reference: paymentReference,
              amount: refundAmount,
              total_refunded: result.totalRefunded,
              fully_refunded: result.fullyRefunded,
              source: "webhook",
            },
          });
        }
      }

      res.json({ received: true, recorded: result.recorded });
      return;
    }

    if (!entity || typeof entity.id !== "string") {
      // Subscription, settlement — events we do not subscribe to but may
      // receive if the dashboard is over-configured. Acknowledge and drop.
      res.json({ received: true, ignored: eventName });
      return;
    }

    // The allowlist of payment events we act on. It matters because several
    // events we do not handle carry a full `payment.entity` with
    // `status: captured` — `payment.dispute.created` most notably — and the
    // dashboard's event list is easy to over-tick. Without this, a dispute on
    // a payment we never recorded would insert a `collected` row, inventing
    // money from a webhook that was telling us the opposite.
    const HANDLED = ["payment.captured", "order.paid", "payment.failed"];
    if (!HANDLED.includes(eventName)) {
      res.json({ received: true, ignored: eventName });
      return;
    }

    const notes = (entity.notes as Record<string, unknown> | null) ?? {};
    const orderId = typeof notes.order_id === "string" ? notes.order_id : null;

    if (!orderId) {
      // Nothing to attach the money to. A retry cannot add notes that were
      // never set, so acknowledge — and shout, because this is money we can
      // see and cannot file.
      console.error("[payments] webhook payment has no order_id in notes:", {
        event: eventName,
        razorpay_payment_id: entity.id,
      });
      res.json({ received: true, ignored: "no_order_reference" });
      return;
    }

    const order = await getOrderById(orderId);
    if (!order) {
      console.error("[payments] webhook references an unknown order:", {
        event: eventName,
        order_id: orderId,
        razorpay_payment_id: entity.id,
      });
      res.json({ received: true, ignored: "unknown_order" });
      return;
    }

    if (eventName === "payment.failed") {
      await recordFailedAttempt(order.id, {
        razorpay_payment_id: entity.id,
        reason:
          typeof entity.error_description === "string" ? entity.error_description : null,
        source: "webhook",
      });
      void notifyPaymentFailed({
        order,
        amount: typeof entity.amount === "number" ? toRupees(entity.amount) : null,
        attemptRef: entity.id,
      });
      res.json({ received: true });
      return;
    }

    // Everything else we act on is a captured payment: `payment.captured`, and
    // `order.paid`, which carries the same entity.
    if (entity.status !== "captured") {
      res.json({ received: true, ignored: `status:${String(entity.status)}` });
      return;
    }

    const amount = typeof entity.amount === "number" ? toRupees(entity.amount) : null;
    if (amount == null || amount <= 0) {
      console.error("[payments] webhook payment has no usable amount:", {
        razorpay_payment_id: entity.id,
      });
      res.json({ received: true, ignored: "no_amount" });
      return;
    }

    const recorded = await recordGatewayPayment({
      order_id: order.id,
      user_id: order.user_id,
      guest_ref: order.guest_ref ?? null,
      amount,
      currency: typeof entity.currency === "string" ? entity.currency : "INR",
      reference: entity.id,
      metadata: {
        source: "webhook",
        event: eventName,
        razorpay_order_id: typeof entity.order_id === "string" ? entity.order_id : null,
        razorpay_payment_id: entity.id,
        method: typeof entity.method === "string" ? entity.method : null,
      },
    });

    if (!recorded) {
      // A DB hiccup, most likely. 500 puts it back in Razorpay's retry queue,
      // which is the one queue we have that survives a restart.
      console.error("[payments] webhook could not record payment — asking for a retry:", {
        order_id: order.id,
        razorpay_payment_id: entity.id,
      });
      res.status(500).json({ message: "Could not record payment" });
      return;
    }

    // Only the delivery that actually created the row writes an event, so a
    // retried webhook does not fill the customer's timeline with duplicates.
    if (recorded.created) {
      void insertOrderEvent({
        order_id: order.id,
        status: order.status,
        note: `Paid ₹${amount} online`,
        actor_user_id: order.user_id,
        metadata: { payment_id: recorded.payment.id, reference: entity.id, source: "webhook" },
      });

      // See the matching block in `verify` — whichever of the two recorded the
      // payment is the one that tells the customer about it.
      void notifyPaymentReceived({ order, amount, txnId: recorded.payment.txn_id });
    }

    res.json({ received: true, recorded: recorded.created });
  });
}
