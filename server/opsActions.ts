/**
 * Phase 3B — Admin lifecycle action handlers (ops surface).
 *
 * Wired from POST /api/orders/:id/actions default branch. Agent cases stay in
 * routes.ts. generate_docket writes a mock AWB (demo).
 */

import { z } from "zod";
import { transitionOrderStatus } from "./agentDb.js";
import { itdClient, type RateParams } from "./itd.js";
import { withTimeout } from "./itdTokenRefresh.js";
import {
  applyGenerateDocket,
  applyMarkDispatched,
  applyWeighResult,
  getAddressCityPincode,
} from "./opsDb.js";
import type { Order, OrderStatus } from "../shared/orderContract.js";

const RATES_TIMEOUT_MS = 10_000;

export type OpsActionError = {
  status: number;
  message: string;
  code: string;
  extra?: Record<string, unknown>;
};

export type OpsActionOk = {
  order: Order;
  eventNote: string;
  eventMeta: Record<string, unknown>;
};

export type OpsActionResult = OpsActionOk | { error: OpsActionError };

function isOk(r: OpsActionResult): r is OpsActionOk {
  return !("error" in r);
}

export { isOk as isOpsActionOk };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function strField(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export type RepriceOk = {
  ok: true;
  finalAmount: number;
  source: "itd_requery" | "formula_fallback";
  matchedServiceCode?: string;
  quotedAmount: number | null;
  delta: number | null;
  apiServiceCode: string | null;
};

export type RepriceFail = {
  ok: false;
  code: "RETRY_REPRICE";
  message: string;
};

/** Re-query ITD rates at actual weight; formula fallback; else RETRY_REPRICE. */
export async function repriceOrderAtWeight(
  order: Order,
  actualWeightKg: number
): Promise<RepriceOk | RepriceFail> {
  const items = asRecord(order.items);
  const consignee = asRecord(order.consignee);
  const apiServiceCode = strField(items, "api_service_code");
  const quotedAmount = order.quoted_amount;

  const productCode = strField(items, "product_code");
  const destinationCode =
    strField(items, "destination_code") ?? strField(consignee, "country_code");

  let oriCity = strField(items, "shipper_city");
  let oriPincode = strField(items, "shipper_zip_code");
  if (order.origin_address_id) {
    const addr = await getAddressCityPincode(order.origin_address_id);
    if (addr) {
      oriCity = addr.city ?? oriCity;
      oriPincode = addr.pincode ?? oriPincode;
    }
  }

  const destCity =
    strField(consignee, "city") ?? strField(items, "consignee_city");
  const destPincode =
    strField(consignee, "pincode") ?? strField(items, "consignee_zip_code");

  const tryFormula = (): RepriceOk | RepriceFail => {
    const booked = order.booked_weight;
    if (
      quotedAmount != null &&
      Number.isFinite(quotedAmount) &&
      booked != null &&
      booked > 0
    ) {
      const finalAmount =
        Math.round(quotedAmount * (actualWeightKg / booked) * 100) / 100;
      return {
        ok: true,
        finalAmount,
        source: "formula_fallback",
        quotedAmount,
        delta: Math.round((finalAmount - quotedAmount) * 100) / 100,
        apiServiceCode,
      };
    }
    return {
      ok: false,
      code: "RETRY_REPRICE",
      message:
        "Could not reprice this order. ITD rates failed and formula fallback needs quoted amount and booked weight. Try again.",
    };
  };

  if (!productCode || !destinationCode) {
    return tryFormula();
  }

  const rateParams: RateParams = {
    product_code: productCode,
    destination_code: destinationCode,
    booking_date: new Date().toISOString().split("T")[0]!,
    origin_code: strField(items, "shipper_country") ?? "IN",
    pcs: strField(items, "pcs") ?? "1",
    actual_weight: String(actualWeightKg),
    ...(oriCity ? { ori_city: oriCity.toUpperCase() } : {}),
    ...(oriPincode ? { ori_pincode: oriPincode } : {}),
    ...(destCity ? { dest_city: destCity.toUpperCase() } : {}),
    ...(destPincode ? { dest_pincode: destPincode } : {}),
  };

  try {
    const raw = await withTimeout(
      itdClient.getRates(rateParams),
      RATES_TIMEOUT_MS,
      "ITD getRates (ops reprice)"
    );

    const list: unknown[] = Array.isArray(raw)
      ? raw
      : raw &&
          typeof raw === "object" &&
          Array.isArray((raw as { data?: unknown }).data)
        ? ((raw as { data: unknown[] }).data)
        : [];

    if (apiServiceCode && list.length > 0) {
      for (const item of list) {
        const row = asRecord(item);
        if (!row) continue;
        const code =
          strField(row, "code") ?? strField(row, "internal_api_service_code");
        if (code !== apiServiceCode) continue;
        const total = Number(row.total);
        if (!Number.isFinite(total) || total < 0) continue;
        const finalAmount = Math.round(total * 100) / 100;
        return {
          ok: true,
          finalAmount,
          source: "itd_requery",
          matchedServiceCode: code,
          quotedAmount,
          delta:
            quotedAmount != null
              ? Math.round((finalAmount - quotedAmount) * 100) / 100
              : null,
          apiServiceCode,
        };
      }
    }
  } catch (err) {
    console.error("[opsActions] reprice getRates failed:", err);
  }

  return tryFormula();
}

export async function handleMarkReceivedDropoff(input: {
  order: Order;
  callerId: string;
  expectedFrom: OrderStatus;
  to: OrderStatus;
}): Promise<OpsActionResult> {
  const updated = await transitionOrderStatus({
    orderId: input.order.id,
    expectedFrom: input.expectedFrom,
    to: input.to,
  });
  if (!updated) {
    return {
      error: {
        status: 409,
        message: "This order has already moved on. Refresh and try again.",
        code: "ORDER_STATE_CHANGED",
      },
    };
  }
  return {
    order: updated,
    eventNote: "Marked received at hub (drop-off)",
    eventMeta: { action: "mark_received_dropoff" },
  };
}

const weighPayloadSchema = z.object({
  actual_weight: z.number().positive("actual_weight must be greater than zero"),
});

export async function handleWeigh(input: {
  order: Order;
  callerId: string;
  expectedFrom: OrderStatus;
  to: OrderStatus;
  payload: unknown;
}): Promise<OpsActionResult> {
  const parsed = weighPayloadSchema.safeParse(input.payload ?? {});
  if (!parsed.success) {
    return {
      error: {
        status: 400,
        message: parsed.error.issues[0]?.message ?? "Invalid weigh payload",
        code: "INVALID_PAYLOAD",
      },
    };
  }

  const actualWeight = parsed.data.actual_weight;
  const reprice = await repriceOrderAtWeight(input.order, actualWeight);
  if (!reprice.ok) {
    return {
      error: {
        status: 502,
        message: reprice.message,
        code: reprice.code,
      },
    };
  }

  const updated = await applyWeighResult({
    orderId: input.order.id,
    expectedFrom: input.expectedFrom,
    actualWeight,
    finalAmount: reprice.finalAmount,
  });
  if (!updated) {
    return {
      error: {
        status: 409,
        message: "This order has already moved on. Refresh and try again.",
        code: "ORDER_STATE_CHANGED",
      },
    };
  }

  const q = reprice.quotedAmount;
  const f = reprice.finalAmount;
  const d = reprice.delta;
  const note =
    q != null && d != null
      ? `Weighed ${actualWeight} kg · ₹${q} → ₹${f} (Δ ₹${d}) [${reprice.source}]`
      : `Weighed ${actualWeight} kg · final ₹${f} [${reprice.source}]`;

  return {
    order: updated,
    eventNote: note,
    eventMeta: {
      action: "weigh",
      actual_weight: actualWeight,
      quoted_amount: q,
      final_amount: f,
      delta: d,
      reprice_source: reprice.source,
      ...(reprice.apiServiceCode
        ? { api_service_code: reprice.apiServiceCode }
        : {}),
      ...(reprice.matchedServiceCode
        ? { matched_service_code: reprice.matchedServiceCode }
        : {}),
    },
  };
}

export async function handleSettle(input: {
  order: Order;
  callerId: string;
  expectedFrom: OrderStatus;
  to: OrderStatus;
}): Promise<OpsActionResult> {
  const updated = await transitionOrderStatus({
    orderId: input.order.id,
    expectedFrom: input.expectedFrom,
    to: input.to,
  });
  if (!updated) {
    return {
      error: {
        status: 409,
        message: "This order has already moved on. Refresh and try again.",
        code: "ORDER_STATE_CHANGED",
      },
    };
  }

  const q = updated.quoted_amount;
  const f = updated.final_amount;
  return {
    order: updated,
    eventNote: `Settled · quoted ₹${q ?? "—"} · final ₹${f ?? "—"} · payment ${updated.payment_status}`,
    eventMeta: {
      action: "settle",
      quoted_amount: q,
      final_amount: f,
      payment_status: updated.payment_status,
    },
  };
}

function mockAwbNo(): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  return `BMB${yy}${mm}${dd}${rand}`;
}

export async function handleGenerateDocket(input: {
  order: Order;
  callerId: string;
}): Promise<OpsActionResult> {
  const awbNo = mockAwbNo();
  const generatedAt = new Date().toISOString();
  const docketId = Math.floor(Math.random() * 900_000) + 100_000;

  const updated = await applyGenerateDocket({
    orderId: input.order.id,
    awbNo,
    docketResponse: {
      mock: true,
      docket_id: docketId,
      awb_no: awbNo,
      generated_at: generatedAt,
    },
  });
  if (!updated) {
    return {
      error: {
        status: 409,
        message: "This order has already moved on. Refresh and try again.",
        code: "ORDER_STATE_CHANGED",
      },
    };
  }

  return {
    order: updated,
    eventNote: `Docket generated · AWB ${awbNo}`,
    eventMeta: {
      action: "generate_docket",
      awb_no: awbNo,
    },
  };
}

/**
 * Close out an order whose docket was filed at booking.
 *
 * No ITD call: the shipment is already in ITD, filed on the customer's own
 * token when they booked. All that is left is to say the parcel has left us,
 * which is what `dispatched` means and what releases the customer's dispatch
 * message in `notify.ts`.
 */
export async function handleMarkDispatched(input: {
  order: Order;
  callerId: string;
}): Promise<OpsActionResult> {
  const updated = await applyMarkDispatched({ orderId: input.order.id });
  if (!updated) {
    return {
      error: {
        status: 409,
        message: "This order has already moved on. Refresh and try again.",
        code: "ORDER_STATE_CHANGED",
      },
    };
  }

  return {
    order: updated,
    eventNote: `Dispatched · AWB ${updated.awb_no} (docketed at booking)`,
    eventMeta: {
      action: "mark_dispatched",
      awb_no: updated.awb_no,
      docketed_at_booking: true,
    },
  };
}
