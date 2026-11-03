/**
 * The ops actions that put a real AWB on an order.
 *
 *   generate_docket  settled → dispatched. A real ITD filing on the
 *                    customer's own ITD account (server/docketFiling.ts).
 *                    Replaces the mock AWB this action used to invent.
 *   record_awb       settled → dispatched, for a customer with no ITD login to
 *                    file under: ops files it in ITD's portal and enters the AWB.
 *   retry_docket     no status change. Files again after a failure.
 */

import type { Order } from "../shared/orderContract.js";
import { fileDocket, type FileDocketResult } from "./docketFiling.js";
import { applyGenerateDocket, applyMarkDispatched } from "./opsDb.js";
import { clearBookingDocketError, getOrderById } from "./ordersDb.js";
import type { OpsActionResult } from "./opsActions.js";

/** What ops is told when a filing does not produce an AWB. */
function refusal(result: Exclude<FileDocketResult, { status: "issued" }>): OpsActionResult {
  switch (result.status) {
    case "no_login":
      return {
        error: {
          status: 409,
          code: "NEEDS_MANUAL_AWB",
          message:
            "This customer has no ITD login of their own to file under. File the docket in the ITD portal, then use Enter AWB from ITD portal.",
        },
      };
    case "busy":
      return {
        error: {
          status: 409,
          code: "DOCKET_BUSY",
          message: "This order's docket is being filed right now, or already has an AWB. Refresh in a minute.",
        },
      };
    case "failed":
      return {
        error: {
          status: 422,
          code: "DOCKET_FAILED",
          message: [result.message, ...(result.problems ?? []).map((p) => `• ${p}`)].join("\n"),
          extra: { stage: result.stage, retry: result.retry, problems: result.problems ?? [] },
        },
      };
  }
}

const MOVED_ON: OpsActionResult = {
  error: { status: 409, message: "This order has already moved on. Refresh and try again.", code: "ORDER_STATE_CHANGED" },
};

export async function handleRetryDocket(input: { order: Order; callerId: string }): Promise<OpsActionResult> {
  const result = await fileDocket(input.order, {
    source: "ops_retry",
    actorUserId: input.callerId,
    writeEvent: false,
  });
  if (result.status !== "issued") return refusal(result);

  const fresh = await getOrderById(input.order.id);
  if (!fresh) return MOVED_ON;
  return {
    order: fresh,
    eventNote: `AWB issued on retry · AWB ${result.awb_no}`,
    eventMeta: { action: "retry_docket", awb_no: result.awb_no },
  };
}

export async function handleGenerateDocket(input: { order: Order; callerId: string }): Promise<OpsActionResult> {
  const result = await fileDocket(input.order, {
    source: "ops_generate",
    actorUserId: input.callerId,
    writeEvent: false,
  });
  if (result.status !== "issued") return refusal(result);

  // The AWB is on the order now; leaving settled is the second write.
  const dispatched = await applyMarkDispatched({ orderId: input.order.id });
  if (!dispatched) return MOVED_ON;
  return {
    order: dispatched,
    eventNote: `Docket filed · AWB ${result.awb_no}`,
    eventMeta: { action: "generate_docket", awb_no: result.awb_no },
  };
}

const AWB_RE = /^[A-Za-z0-9-]{6,30}$/;

export async function handleRecordAwb(input: {
  order: Order;
  callerId: string;
  payload: unknown;
}): Promise<OpsActionResult> {
  const raw = (input.payload as { awb_no?: unknown } | null)?.awb_no;
  const awbNo = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!AWB_RE.test(awbNo)) {
    return {
      error: { status: 400, code: "BAD_AWB", message: "Enter the AWB exactly as ITD's portal shows it (6 to 30 letters or digits)." },
    };
  }

  const updated = await applyGenerateDocket({
    orderId: input.order.id,
    awbNo,
    docketResponse: { manual: true, awb_no: awbNo, entered_by: input.callerId, entered_at: new Date().toISOString() },
  });
  if (!updated) return MOVED_ON;
  await clearBookingDocketError(input.order.id);

  return {
    order: updated,
    eventNote: `AWB entered from ITD portal · AWB ${awbNo}`,
    eventMeta: { action: "record_awb", awb_no: awbNo },
  };
}
