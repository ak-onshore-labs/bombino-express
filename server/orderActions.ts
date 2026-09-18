/**
 * The agent's lifecycle actions, one function per verb.
 *
 * `POST /api/orders/:id/actions` was a 779-line `switch` with every arm inline
 * — the highest-risk code in the repo and the only place the order state
 * machine lives. The ops arms already moved to `server/opsActions.ts`; these
 * are the agent ones, moving the same way and to the same contract:
 *
 *   (input) => { order, eventNote, eventMeta } | { error: { status, message, code } }
 *
 * The handler maps that onto the response, so an arm never touches `res` and
 * can be tested without an HTTP request.
 *
 * Every arm re-asserts its preconditions in the UPDATE's WHERE clause. The row
 * the route read is stale by definition, so a zero-row result means someone
 * else got there first — which is a 409, not a failure.
 */

import { z } from "zod";

import {
  advanceOrderStatus,
  claimPickup,
  claimOrderRow,
  recordCollectedPayment,
  transitionOrderStatus,
} from "./agentDb.js";
import { reconcilePaymentStatus } from "./paymentsDb.js";
import {
  HANDOVER_CODE_PATTERN,
  burnCodeForOverride,
  issueCode,
  verifyCode,
  type HandoverKind,
} from "./handoverCodes.js";
import {
  readCancellationRequest,
  type Order,
  type OrderStatus,
} from "../shared/orderContract.js";
import {
  getOrderById,
  markCancellationRequestDecided,
  recordCancellationRequest,
} from "./ordersDb.js";
import { notifyAgentOfCancellationRequest, notifyCancellationDeclined } from "./notify.js";
import type { OpsActionResult } from "./opsActions.js";
import type { Role } from "../shared/orderContract.js";

/**
 * Same contract as `opsActions.ts`, with one addition: a collection answers
 * with a receipt the sheet shows without digging through event metadata.
 */
export type AgentActionResult =
  | OpsActionResult
  | (Extract<OpsActionResult, { order: Order }> & {
      receipt: { txnId: string | null; amount: number };
    });

/**
 * An agent takes an unclaimed pickup.
 *
 * The conditional UPDATE decides the winner: two agents can both pass the
 * lifecycle guard, exactly one can pass `.is('agent_id', null)`.
 */
export async function handleClaim(input: {
  order: Order;
  callerId: string;
}): Promise<AgentActionResult> {
  const updated = await claimPickup(input.order.id, input.callerId);
  if (!updated) {
    return {
      error: {
        status: 409,
        message: "Another agent just took this pickup.",
        code: "PICKUP_ALREADY_CLAIMED",
      },
    };
  }

  // The customer can now be told a code, and will want it visible well before
  // the doorbell goes. Best effort: the claim is already committed, and
  // refusing it because a code failed to write would hand the job back to the
  // pool for no good reason. The customer's screen offers a regenerate when
  // there is nothing to show.
  await issueCode(input.order.id, "pickup");

  return { order: updated, eventNote: "Pickup claimed by agent", eventMeta: {} };
}

/**
 * The agent is on their way. Only the agent holding the job, and only on or
 * after the day the customer was promised — both enforced by the lifecycle
 * guard before this runs, and by the WHERE clause once it does.
 */
export async function handleStartPickup(input: {
  order: Order;
  callerId: string;
  expectedFrom: OrderStatus;
  to: OrderStatus;
}): Promise<AgentActionResult> {
  const updated = await advanceOrderStatus({
    orderId: input.order.id,
    agentId: input.callerId,
    expectedFrom: input.expectedFrom,
    to: input.to,
  });
  if (!updated) {
    // Either the order moved under us, or it is not ours. Both are the same
    // answer to the caller, and saying which would disclose whether another
    // agent holds it.
    return {
      error: {
        status: 409,
        message: "This pickup has already moved on. Refresh your list.",
        code: "ORDER_STATE_CHANGED",
      },
    };
  }

  return {
    order: updated,
    eventNote: `Agent moved order to ${input.to}`,
    eventMeta: {},
  };
}


/**
 * Which handover each action completes. Kept as data rather than inferred, so
 * adding a fourth is one line here and one transition row — the discipline
 * `orderLifecycle.ts` follows.
 */
export const HANDOVER_KIND_FOR_ACTION = {
  mark_picked_up: "pickup",
  mark_received_at_hub: "hub",
  mark_received_dropoff: "dropoff",
} as const satisfies Record<string, HandoverKind>;

/**
 * Whose code each handover checks, for the audit note.
 *
 * Not cosmetic: reading "with the hub's code" in an order's history is what
 * tells whoever is investigating a disputed parcel which party was tested.
 */
export const HANDOVER_CODE_OWNER = {
  pickup: "the customer's code",
  hub: "the hub's code",
  dropoff: "the customer's code",
} as const satisfies Record<HandoverKind, string>;

/**
 * One of the three OTP-gated handovers: check the code the other party read
 * out, then move the order.
 *
 * The code is verified BEFORE the status write, so a wrong guess costs an
 * attempt and changes nothing else. Once it is spent the caller must ask for a
 * fresh one rather than retyping — which is why a lost race here says so.
 */
export async function handleHandover(input: {
  order: Order;
  callerId: string;
  role: Role;
  action: keyof typeof HANDOVER_KIND_FOR_ACTION;
  expectedFrom: OrderStatus;
  to: OrderStatus;
  payload: unknown;
}): Promise<AgentActionResult> {
  const kind = HANDOVER_KIND_FOR_ACTION[input.action];

  const otpBody = z
    .object({
      // `required_error` as well as the regex message: a missing key otherwise
      // surfaces zod's bare "Required", which is what an agent would have been
      // shown at a doorstep.
      otp: z
        .string({ required_error: "Enter the code" })
        .trim()
        // Exactly four. The pattern lives in handoverCodes.ts so the length the
        // route accepts cannot drift from the length minted.
        .regex(HANDOVER_CODE_PATTERN, "Enter the 4-digit code"),
    })
    .safeParse(input.payload ?? {});
  if (!otpBody.success) {
    return {
      error: {
        status: 400,
        message: otpBody.error.issues[0]?.message ?? "The handover code is required",
        code: "OTP_REQUIRED",
      },
    };
  }

  const check = await verifyCode({
    orderId: input.order.id,
    kind,
    submitted: otpBody.data.otp,
    verifiedBy: input.callerId,
  });

  if (!check.ok) {
    const messages: Record<typeof check.reason, string> = {
      no_code: "There is no handover code on this order to check.",
      locked: "Too many wrong codes. Ask for a fresh code to be generated, then try again.",
      mismatch:
        check.attemptsLeft > 0
          ? `That code is not right. ${check.attemptsLeft} ${
              check.attemptsLeft === 1 ? "try" : "tries"
            } left.`
          : "That code is not right, and this code is now locked. Ask for a fresh one.",
      error: "Could not check the code. Try again.",
    };
    return {
      error: {
        status: check.reason === "error" ? 502 : 409,
        message: messages[check.reason],
        code: `OTP_${check.reason.toUpperCase()}`,
        extra: { attemptsLeft: check.attemptsLeft },
      },
    };
  }

  // Ownership differs by who is acting: the agent may only advance a job they
  // hold, ops may act on anyone's.
  const updated =
    input.role === "agent"
      ? await advanceOrderStatus({
          orderId: input.order.id,
          agentId: input.callerId,
          expectedFrom: input.expectedFrom,
          to: input.to,
        })
      : await transitionOrderStatus({
          orderId: input.order.id,
          expectedFrom: input.expectedFrom,
          to: input.to,
        });

  if (!updated) {
    // The code is already spent at this point. Saying so matters: the caller
    // must ask for a fresh one rather than retyping the same number and being
    // told it is wrong.
    return {
      error: {
        status: 409,
        message:
          "This order moved on before the code was accepted. Refresh, then ask for a fresh code.",
        code: "ORDER_STATE_CHANGED",
      },
    };
  }

  // The parcel is now in the agent's bag and the next handover is at the hub
  // counter, where ops reads this number off their console. Issued here rather
  // than at the counter so it is already on the ops screen when the agent walks
  // up.
  if (input.action === "mark_picked_up") {
    await issueCode(input.order.id, "hub");
  }

  return {
    order: updated,
    eventNote: `${input.role === "agent" ? "Agent" : "Ops"} completed the ${kind} handover with ${
      HANDOVER_CODE_OWNER[kind]
    }`,
    eventMeta: { handover: kind, verified: true },
  };
}

/** Which handover an ops override is waving through, by the status it acts on. */
export const HANDOVER_KIND_FOR_STATUS: Partial<Record<OrderStatus, HandoverKind>> = {
  out_for_pickup: "pickup",
  picked_up: "hub",
  awaiting_dropoff: "dropoff",
};

/**
 * Ops completes a handover without the code.
 *
 * The customer's phone is dead, the agent is at the door, and the parcel must
 * not be stranded for it. This is the one action in the endpoint with no check
 * on it at all, which is why the reason is required and why the code is spent
 * afterwards — an unspent code could later be used to imply the handover was
 * verified when it was waved through.
 */
export async function handleOverrideHandover(input: {
  order: Order;
  callerId: string;
  expectedFrom: OrderStatus;
  to: OrderStatus;
  payload: unknown;
}): Promise<AgentActionResult> {
  const overrideBody = z
    .object({
      // Required, unlike every other note in this endpoint. An override is the
      // one action here with no check on it at all, so the reason is the only
      // thing anyone can audit it by.
      reason: z
        .string({ required_error: "Say why the code could not be used" })
        .trim()
        .min(3, "Say why the code could not be used")
        .max(300, "Keep the reason under 300 characters"),
    })
    .safeParse(input.payload ?? {});
  if (!overrideBody.success) {
    return {
      error: {
        status: 400,
        message: overrideBody.error.issues[0]?.message ?? "A reason is required",
        code: "REASON_REQUIRED",
      },
    };
  }

  const kind = HANDOVER_KIND_FOR_STATUS[input.expectedFrom];

  const updated = await transitionOrderStatus({
    orderId: input.order.id,
    expectedFrom: input.expectedFrom,
    to: input.to,
  });
  if (!updated) {
    return {
      error: {
        status: 409,
        message: "This order has already moved on.",
        code: "ORDER_STATE_CHANGED",
      },
    };
  }

  // Spend the code so it cannot be used afterwards to imply the handover was
  // verified when it was waved through.
  if (kind) {
    await burnCodeForOverride({ orderId: input.order.id, kind, overriddenBy: input.callerId });
  }

  return {
    order: updated,
    eventNote: `Ops completed the ${kind ?? "handover"} without a code: ${overrideBody.data.reason}`,
    eventMeta: { handover: kind, override: true, reason: overrideBody.data.reason },
  };
}

/**
 * Money taken at the door by an agent, or at the counter by ops.
 *
 * One shape, two collection points: the agent's is `pay_at_pickup` and stops a
 * parcel leaving the doorstep unpaid, ops' is `pay_at_dropoff` and stops an
 * order settling unpaid. Neither moves the order — a collection is a `payments`
 * write, and the status is somebody else's business.
 *
 * `collection_mode` is required rather than inferred: only one of cash and UPI
 * ends up in the agent's pouch at the end of the shift, and a write that fails
 * must stop the handover, which is why the refusal says so in as many words.
 */
export async function handleCollectPayment(input: {
  order: Order;
  callerId: string;
  role: Role;
  payload: unknown;
}): Promise<AgentActionResult> {
  const atPickup = input.role === "agent";
  const isOps = input.role === "admin" || input.role === "super_admin";
  if (!atPickup && !isOps) {
    return {
      error: {
        status: 403,
        message: "You do not have permission to collect payment on this order.",
        code: "FORBIDDEN",
      },
    };
  }

  // At the door only a pay-at-pickup order is collected. At the hub, after
  // weighing, ops collects whatever is still owed on any non-COD order: the
  // drop-off counter payment, or the difference on a prepaid parcel that came
  // in heavier than booked.
  const methodOk = atPickup
    ? input.order.payment_method === "pay_at_pickup"
    : input.order.payment_method !== "cod" && !input.order.is_cod;
  if (!methodOk) {
    return {
      error: {
        status: 400,
        message: atPickup
          ? "This order is not marked pay-at-pickup."
          : "Cash on delivery is not collected by us.",
        code: "PAYMENT_METHOD_MISMATCH",
      },
    };
  }

  const paymentBody = z
    .object({
      amount: z.number().positive("amount must be greater than zero"),
      // How the money actually moved. Required: an agent handing over a parcel
      // must have said whether they hold cash or watched a UPI transfer land,
      // because only one of those ends up in their pouch at the end of the
      // shift.
      collection_mode: z.enum(["upi", "cash"], {
        errorMap: () => ({ message: "Choose UPI or cash" }),
      }),
      // UPI reference from the customer's app, if they read it out.
      reference: z.string().trim().max(120).optional().nullable(),
    })
    .safeParse(input.payload ?? {});
  if (!paymentBody.success) {
    return {
      error: {
        status: 400,
        message: paymentBody.error.issues[0]?.message ?? "Invalid payment payload",
        code: "INVALID_PAYLOAD",
      },
    };
  }

  // A double tap sends two identical collections. Both pass the "still owed"
  // guard — it read the same row — and both would insert a payment. Claiming
  // the row by the `updated_at` we read lets exactly one through; the other is
  // told the order has moved.
  if (!(await claimOrderRow(input.order.id, input.order.updated_at))) {
    return {
      error: {
        status: 409,
        message: "This payment has already been recorded. Refresh to see it.",
        code: "ORDER_STATE_CHANGED",
      },
    };
  }

  const result = await recordCollectedPayment({
    order_id: input.order.id,
    user_id: input.order.user_id,
    guest_ref: input.order.guest_ref ?? null,
    amount: paymentBody.data.amount,
    // Where the money was taken, not how the order was booked: a prepaid
    // order's reweigh difference paid at the hub is a counter collection.
    method: atPickup ? "pay_at_pickup" : "pay_at_dropoff",
    status: "collected",
    collection_mode: paymentBody.data.collection_mode,
    collected_by: input.callerId,
    reference: paymentBody.data.reference ?? null,
  });
  if (!result) {
    return {
      error: {
        status: 502,
        message: atPickup
          ? "Could not record the payment. Do not hand over the parcel."
          : "Could not record the payment. Do not settle yet.",
        code: "PAYMENT_WRITE_FAILED",
      },
    };
  }

  return {
    // Deliberately no status change — the parcel is where it was.
    order: result.order ?? input.order,
    eventNote: `Collected ₹${paymentBody.data.amount} at ${
      atPickup ? "pickup" : "drop-off"
    } (${paymentBody.data.collection_mode})`,
    eventMeta: {
      payment_id: result.paymentId,
      txn_id: result.txnId,
      amount: paymentBody.data.amount,
      collection_mode: paymentBody.data.collection_mode,
    },
    receipt: { txnId: result.txnId, amount: paymentBody.data.amount },
  };
}

/**
 * The customer asks to cancel. It does not decide anything — ops does that —
 * so the order does not move and the agent is still expected to collect it.
 */
export async function handleRequestCancellation(input: {
  order: Order;
  callerId: string;
  payload: unknown;
}): Promise<AgentActionResult> {
  const requestBody = z
    .object({
      // Optional, and capped: this is a note for whoever picks the request up,
      // not a support ticket.
      reason: z
        .string()
        .trim()
        .max(300, "Keep the reason under 300 characters")
        .optional()
        .nullable(),
    })
    .safeParse(input.payload ?? {});
  if (!requestBody.success) {
    return {
      error: {
        status: 400,
        message: requestBody.error.issues[0]?.message ?? "Invalid request payload",
        code: "INVALID_PAYLOAD",
      },
    };
  }

  const reason = requestBody.data.reason?.trim() || null;

  const updated = await recordCancellationRequest({
    orderId: input.order.id,
    userId: input.callerId,
    // The states a request is legal from, mirrored from the transition table so
    // the WHERE clause re-asserts what the guard checked.
    expectedStatuses: ["pickup_requested", "awaiting_dropoff", "agent_accepted"],
    reason,
  });
  if (!updated) {
    return {
      error: {
        status: 409,
        message: "This order has already moved on. Call support if you still need it cancelled.",
        code: "ORDER_STATE_CHANGED",
      },
    };
  }

  // Warn the agent holding it. The order has not moved, so the message says
  // wait rather than stop — but an agent who sets off now may find a customer
  // who has already decided they are not sending anything.
  void notifyAgentOfCancellationRequest(updated);

  return {
    order: updated,
    eventNote: reason ? `Customer requested cancellation: ${reason}` : "Customer requested cancellation",
    eventMeta: { reason },
  };
}

/**
 * Ops cancels. Whether they were acting on a request or on a phone call is the
 * first thing anyone asks afterwards, so the event says which.
 */
export async function handleCancel(input: {
  order: Order;
  callerId: string;
  expectedFrom: OrderStatus;
  to: OrderStatus;
}): Promise<AgentActionResult> {
  // Ops only — `orderLifecycle.ts` gives the customer no `cancel` row, so a
  // customer reaching here has already been refused by `findTransition`.
  const moved = await transitionOrderStatus({
    orderId: input.order.id,
    expectedFrom: input.expectedFrom,
    to: input.to,
  });
  if (!moved) {
    return {
      error: {
        status: 409,
        message: "This order has already moved on and can no longer be cancelled.",
        code: "ORDER_STATE_CHANGED",
      },
    };
  }
  // Money already taken on a cancelled order is owed back: flag `refund_due`
  // for accounts. Without this a prepaid cancellation went on reading `paid`.
  const reconciled = await reconcilePaymentStatus(input.order.id);
  const updated = reconciled ? { ...moved, payment_status: reconciled.payment_status } : moved;

  const request = readCancellationRequest(input.order);
  if (request) {
    // Best effort: the cancellation is already committed above, and failing the
    // response because an audit field did not write would tell ops the
    // cancellation failed when it did not.
    await markCancellationRequestDecided({
      orderId: input.order.id,
      decision: "approved",
      decidedBy: input.callerId,
      note: null,
    });
  }

  return {
    order: updated,
    eventNote: request
      ? "Order cancelled by ops on the customer's request"
      : "Order cancelled by ops",
    eventMeta: request
      ? { requested_at: request.requested_at, requested_reason: request.reason }
      : {},
  };
}

/**
 * Ops declines the request and the order carries on.
 *
 * Nothing moves — that is the decision — which is why the customer has to be
 * told explicitly. An approval announces itself as the order turning
 * `cancelled`; a decline changes nothing on screen, so without the notification
 * the customer waits forever.
 */
export async function handleRejectCancellation(input: {
  order: Order;
  callerId: string;
  payload: unknown;
}): Promise<AgentActionResult> {
  const rejectBody = z
    .object({
      // The customer reads this. Optional, because a decline over the phone may
      // already have been explained.
      note: z
        .string()
        .trim()
        .max(300, "Keep the note under 300 characters")
        .optional()
        .nullable(),
    })
    .safeParse(input.payload ?? {});
  if (!rejectBody.success) {
    return {
      error: {
        status: 400,
        message: rejectBody.error.issues[0]?.message ?? "Invalid decision payload",
        code: "INVALID_PAYLOAD",
      },
    };
  }

  const note = rejectBody.data.note?.trim() || null;

  const written = await markCancellationRequestDecided({
    orderId: input.order.id,
    decision: "rejected",
    decidedBy: input.callerId,
    note,
  });
  if (!written) {
    return {
      error: {
        status: 409,
        message: "There is no open cancellation request on this order.",
        code: "NO_OPEN_REQUEST",
      },
    };
  }

  // Re-read so the response and the recomputed actions reflect the decision
  // just written.
  const updated = (await getOrderById(input.order.id)) ?? input.order;
  void notifyCancellationDeclined({ order: updated, note });

  return {
    order: updated,
    eventNote: note ? `Cancellation declined by ops: ${note}` : "Cancellation declined by ops",
    eventMeta: { note },
  };
}
