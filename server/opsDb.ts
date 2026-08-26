/**
 * Phase 3A — Ops order reads (board + detail).
 *
 * Separate from ordersDb / agentDb so Aditya's modules stay untouched.
 * No ownership filter: admin/super_admin see every order.
 */

import { supabase } from "./supabaseClient.js";
import {
  cancellationState,
  readCancellationRequest,
  type Order,
} from "../shared/orderContract.js";
import {
  applyOpsBoardQuery,
  filterConfigForSection,
  type OpsBoardFilters,
  type OpsBoardSection,
  type OpsBoardSort,
} from "../shared/opsBoardQuery.js";
import { nowInIst, startOfIstDayIso } from "../shared/pickupSlots.js";
import { getUserContactsByIds, toOrder, type OrderRow } from "./ordersDb.js";

/** PostgREST default max-rows is ~1000; page past that so export never truncates. */
const EXPORT_PAGE_SIZE = 1000;

const BOARD_COLUMNS =
  "id, order_no, status, created_at, pickup_request, pickup_date, payment_method, payment_status, is_cod, quoted_amount, final_amount, consignee, agent_id, awb_no";

const DETAIL_COLUMNS =
  "id, order_no, user_id, status, pickup_request, pickup_date, origin_address_id, consignee, items, booked_weight, quoted_amount, packaging_required, payment_method, payment_status, is_cod, agent_id, actual_weight, final_amount, awb_no, itd_docket_response, metadata, created_at, updated_at";

function getSupabaseClient() {
  return supabase;
}

function logSupabaseError(op: string, error: { message?: string; code?: string } | null): void {
  console.error(`[opsDb] ${op} failed:`, error?.code, error?.message);
}

function consigneeField(
  consignee: unknown,
  keys: string[]
): string | null {
  if (!consignee || typeof consignee !== "object" || Array.isArray(consignee)) {
    return null;
  }
  const c = consignee as Record<string, unknown>;
  for (const key of keys) {
    const v = c[key];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

export type OpsBoardOrder = {
  id: string;
  order_no: string;
  status: string;
  created_at: string;
  pickup_request: number;
  pickup_date: string | null;
  pickup_slot: string | null;
  payment_method: string;
  payment_status: string;
  is_cod: boolean;
  quoted_amount: number | null;
  final_amount: number | null;
  consignee_name: string | null;
  consignee_city: string | null;
  agent_id: string | null;
  agent_name: string | null;
  awb_no: string | null;
};

export type OpsOrderDetail = {
  id: string;
  order_no: string;
  user_id: string;
  status: string;
  pickup_request: number;
  pickup_date: string | null;
  origin_address_id: string | null;
  consignee: unknown;
  items: unknown;
  booked_weight: number | null;
  quoted_amount: number | null;
  packaging_required: boolean;
  payment_method: string;
  payment_status: string;
  is_cod: boolean;
  agent_id: string | null;
  agent_name: string | null;
  actual_weight: number | null;
  final_amount: number | null;
  awb_no: string | null;
  itd_docket_response: unknown;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type OpsOrderEvent = {
  id: string;
  status: string;
  note: string | null;
  actor_user_id: string | null;
  metadata: unknown;
  created_at: string;
};

function toNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapBoardRow(row: Record<string, unknown>): OpsBoardOrder {
  return {
    id: String(row.id),
    order_no: String(row.order_no),
    status: String(row.status),
    created_at: String(row.created_at),
    pickup_request: row.pickup_request === 2 ? 2 : 1,
    pickup_date: (row.pickup_date as string | null) ?? null,
    pickup_slot: (row.pickup_slot as string | null) ?? null,
    payment_method: String(row.payment_method),
    payment_status: String(row.payment_status),
    is_cod: Boolean(row.is_cod),
    quoted_amount: toNum(row.quoted_amount),
    final_amount: toNum(row.final_amount),
    consignee_name: consigneeField(row.consignee, ["name", "full_name"]),
    consignee_city: consigneeField(row.consignee, ["city", "consignee_city"]),
    agent_id: (row.agent_id as string | null) ?? null,
    agent_name: null,
    awb_no: (row.awb_no as string | null) ?? null,
  };
}

function mapDetailRow(row: Record<string, unknown>): OpsOrderDetail {
  return {
    id: String(row.id),
    order_no: String(row.order_no),
    user_id: String(row.user_id),
    status: String(row.status),
    pickup_request: row.pickup_request === 2 ? 2 : 1,
    pickup_date: (row.pickup_date as string | null) ?? null,
    origin_address_id: (row.origin_address_id as string | null) ?? null,
    consignee: row.consignee ?? null,
    items: row.items ?? null,
    booked_weight: toNum(row.booked_weight),
    quoted_amount: toNum(row.quoted_amount),
    packaging_required: row.packaging_required === true,
    payment_method: String(row.payment_method),
    payment_status: String(row.payment_status),
    is_cod: Boolean(row.is_cod),
    agent_id: (row.agent_id as string | null) ?? null,
    agent_name: null,
    actual_weight: toNum(row.actual_weight),
    final_amount: toNum(row.final_amount),
    awb_no: (row.awb_no as string | null) ?? null,
    itd_docket_response: row.itd_docket_response ?? null,
    metadata: row.metadata ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/** Batch-resolve agent_id → full_name. Missing contacts stay null. */
async function withAgentNames<T extends { agent_id: string | null; agent_name: string | null }>(
  orders: T[]
): Promise<T[]> {
  const ids = orders
    .map((order) => order.agent_id)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return orders;

  const contacts = await getUserContactsByIds(ids);
  return orders.map((order) => {
    if (!order.agent_id) return order;
    const name = contacts.get(order.agent_id)?.full_name?.trim();
    return { ...order, agent_name: name ? name : null };
  });
}

/** Newest-first board list. Hard cap 200. Optional exact status filter. */
export async function listAllOrdersForOps(opts: {
  status?: string;
  limit?: number;
}): Promise<OpsBoardOrder[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const limit = opts.limit ?? 200;
  let query = client
    .from("orders")
    .select(BOARD_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.status) {
    query = query.eq("status", opts.status);
  }

  const { data, error } = await query;
  if (error) {
    logSupabaseError("listAllOrdersForOps", error);
    return null;
  }

  return withAgentNames((data ?? []).map((row) => mapBoardRow(row as Record<string, unknown>)));
}

/** Full order by id — no user_id filter. */
export async function getOrderByIdForOps(id: string): Promise<OpsOrderDetail | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logSupabaseError("getOrderByIdForOps", error);
    return null;
  }
  if (!data) return null;

  const [detail] = await withAgentNames([mapDetailRow(data as Record<string, unknown>)]);
  return detail ?? null;
}

/**
 * Admin-directed assign. Copies claimPickup's atomic UPDATE so self-claim and
 * ops-assign share one mutex: exactly one winner under READ COMMITTED.
 *
 * Do not import claimPickup — Aditya owns agentDb.ts.
 */
export async function assignPickup(
  orderId: string,
  agentId: string
): Promise<Order | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .update({
      agent_id: agentId,
      status: "agent_accepted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("status", "pickup_requested")
    .is("agent_id", null)
    .select(DETAIL_COLUMNS)
    .maybeSingle();

  if (error) {
    logSupabaseError("assignPickup", error);
    return null;
  }
  if (!data) return null;
  return toOrder(data as unknown as OrderRow & { metadata?: unknown });
}

/** Timeline events for an order, oldest first. */
export async function listOrderEventsForOps(
  orderId: string
): Promise<OpsOrderEvent[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("order_events")
    .select("id, status, note, actor_user_id, metadata, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (error) {
    logSupabaseError("listOrderEventsForOps", error);
    return null;
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    status: String(row.status),
    note: (row.note as string | null) ?? null,
    actor_user_id: (row.actor_user_id as string | null) ?? null,
    metadata: row.metadata ?? null,
    created_at: String(row.created_at),
  }));
}

/** Origin city/pincode for reprice — optional join off origin_address_id. */
export async function getAddressCityPincode(
  addressId: string
): Promise<{ city: string | null; pincode: string | null } | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("addresses")
    .select("city, pincode")
    .eq("id", addressId)
    .maybeSingle();

  if (error) {
    logSupabaseError("getAddressCityPincode", error);
    return null;
  }
  if (!data) return null;

  return {
    city: typeof data.city === "string" ? data.city : null,
    pincode: typeof data.pincode === "string" ? data.pincode : null,
  };
}

/**
 * Capture hub weight + final amount and advance received_at_hub → weighed.
 * Status precondition in WHERE so a concurrent move returns null (409).
 */
export async function applyWeighResult(input: {
  orderId: string;
  expectedFrom: string;
  actualWeight: number;
  finalAmount: number;
}): Promise<Order | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .update({
      actual_weight: input.actualWeight,
      final_amount: input.finalAmount,
      status: "weighed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.orderId)
    .eq("status", input.expectedFrom)
    .select(DETAIL_COLUMNS)
    .maybeSingle();

  if (error) {
    logSupabaseError("applyWeighResult", error);
    return null;
  }
  if (!data) return null;

  return toOrder(data as unknown as OrderRow & { metadata?: unknown });
}

export type MockDocketResponse = {
  mock: true;
  docket_id: number;
  awb_no: string;
  generated_at: string;
};

/**
 * Mock docket write: settled → dispatched with a fake AWB.
 * Double-fire guard is `awb_no IS NULL` plus status = settled.
 */
export async function applyGenerateDocket(input: {
  orderId: string;
  awbNo: string;
  docketResponse: MockDocketResponse;
}): Promise<Order | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .update({
      status: "dispatched",
      awb_no: input.awbNo,
      itd_docket_response: input.docketResponse,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.orderId)
    .eq("status", "settled")
    .is("awb_no", null)
    .select(DETAIL_COLUMNS)
    .maybeSingle();

  if (error) {
    logSupabaseError("applyGenerateDocket", error);
    return null;
  }
  if (!data) return null;

  return toOrder(data as unknown as OrderRow & { metadata?: unknown });
}

export type OpsPaymentRange = "today" | "7d";

export type OpsPaymentRow = {
  id: string;
  txn_id: string | null;
  order_id: string;
  order_no: string | null;
  amount: number;
  currency: string;
  method: string;
  collection_mode: "cash" | "upi" | null;
  collected_by: string | null;
  collector_name: string;
  collected_at: string | null;
  status: string;
  reference: string | null;
};

export type OpsPaymentTotals = {
  all: number;
  cash: number;
  upi: number;
  gateway: number;
  count: number;
};

export type OpsPendingCancellation = {
  id: string;
  order_no: string;
  consignee_name: string | null;
  requested_at: string;
  reason: string | null;
};

function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function startIsoForRange(range: OpsPaymentRange): string {
  const today = nowInIst().date;
  if (range === "7d") return startOfIstDayIso(addCalendarDays(today, -6));
  return startOfIstDayIso(today);
}

function threeWayTotals(payments: OpsPaymentRow[]): OpsPaymentTotals {
  let all = 0;
  let cash = 0;
  let upi = 0;
  let gateway = 0;
  for (const payment of payments) {
    all += payment.amount;
    if (payment.collection_mode === "cash") cash += payment.amount;
    else if (payment.collection_mode === "upi") upi += payment.amount;
    else if (payment.collection_mode == null && payment.method === "pay_now") {
      gateway += payment.amount;
    }
  }
  return { all, cash, upi, gateway, count: payments.length };
}

/**
 * Ops-wide payment ledger. No collected_by filter — cash, UPI, and gateway
 * all appear. Window is IST today or the last 7 IST days.
 *
 * `limit` defaults to 500 for the ledger/dashboard. Pass `null` for export
 * (omit `.limit()`). If payments ever exceed PostgREST max-rows (~1000),
 * paginate with `.range()` — not needed at current volume (~24 rows).
 */
export async function listOpsPayments(
  range: OpsPaymentRange,
  opts?: { limit?: number | null }
): Promise<{ payments: OpsPaymentRow[]; totals: OpsPaymentTotals } | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const startIso = startIsoForRange(range);
  const limit = opts?.limit === undefined ? 500 : opts.limit;
  let query = client
    .from("payments")
    .select(
      "id, txn_id, order_id, amount, currency, method, collection_mode, collected_by, collected_at, status, reference, orders(order_no)"
    )
    .gte("collected_at", startIso)
    .order("collected_at", { ascending: false });

  if (limit != null) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    logSupabaseError("listOpsPayments", error);
    return null;
  }

  const raw = (data ?? []) as Array<Record<string, unknown>>;
  const collectorIds = raw
    .map((row) => row.collected_by)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const contacts = await getUserContactsByIds(collectorIds);

  const payments: OpsPaymentRow[] = raw.map((row) => {
    const collectedBy = (row.collected_by as string | null) ?? null;
    const named = collectedBy ? contacts.get(collectedBy)?.full_name?.trim() : null;
    const embedded = row.orders as
      | { order_no?: string }
      | { order_no?: string }[]
      | null;
    const orderNo = Array.isArray(embedded)
      ? (embedded[0]?.order_no ?? null)
      : (embedded?.order_no ?? null);
    const mode = row.collection_mode;
    return {
      id: String(row.id),
      txn_id: (row.txn_id as string | null) ?? null,
      order_id: String(row.order_id),
      order_no: orderNo ?? null,
      amount: Number(row.amount),
      currency: String(row.currency ?? "INR"),
      method: String(row.method),
      collection_mode: mode === "cash" || mode === "upi" ? mode : null,
      collected_by: collectedBy,
      collector_name: collectedBy ? named || "Staff" : "Online",
      collected_at: (row.collected_at as string | null) ?? null,
      status: String(row.status),
      reference: (row.reference as string | null) ?? null,
    };
  });

  return { payments, totals: threeWayTotals(payments) };
}

export type OpsOrdersExportParams = {
  section: OpsBoardSection;
  filters: OpsBoardFilters;
  query: string;
  sort: OpsBoardSort;
};

/**
 * Uncapped board export. Section gate runs in PostgREST (paginated); search /
 * COD / IST windows / assignment / stage / payment / sort run in JS via
 * applyOpsBoardQuery so they cannot drift from the client board.
 */
export async function listOpsOrdersForExport(
  params: OpsOrdersExportParams
): Promise<OpsBoardOrder[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const rawRows: Record<string, unknown>[] = [];
  let from = 0;

  for (;;) {
    let query = client
      .from("orders")
      .select(BOARD_COLUMNS)
      .order("created_at", { ascending: false })
      .range(from, from + EXPORT_PAGE_SIZE - 1);

    if (params.section === "pickups") {
      query = query
        .eq("pickup_request", 1)
        .neq("status", "dispatched")
        .neq("status", "cancelled");
    } else if (params.section === "dropoffs") {
      query = query
        .eq("pickup_request", 2)
        .neq("status", "dispatched")
        .neq("status", "cancelled");
    } else {
      query = query.eq("status", "dispatched");
    }

    const { data, error } = await query;
    if (error) {
      logSupabaseError("listOpsOrdersForExport", error);
      return null;
    }

    const page = (data ?? []) as Record<string, unknown>[];
    rawRows.push(...page);
    if (page.length < EXPORT_PAGE_SIZE) break;
    from += EXPORT_PAGE_SIZE;
  }

  const mapped = await withAgentNames(rawRows.map((row) => mapBoardRow(row)));
  const config = filterConfigForSection(params.section);
  return applyOpsBoardQuery(mapped, {
    filters: params.filters,
    config,
    query: params.query,
    sort: params.sort,
  });
}

/**
 * Open cancellation requests. SQL only checks that a request blob exists and
 * the order is not already cancelled; pending vs rejected is cancellationState
 * (absent metadata status counts as pending).
 */
export async function listPendingCancellationsForOps(): Promise<{
  cancellations: OpsPendingCancellation[];
  count: number;
} | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .select("id, order_no, user_id, status, consignee, metadata, created_at, updated_at")
    .not("metadata->cancellation_request", "is", null)
    .neq("status", "cancelled")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    logSupabaseError("listPendingCancellationsForOps", error);
    return null;
  }

  const pending = (data ?? [])
    .map((row) => toOrder(row as unknown as OrderRow & { metadata?: unknown }))
    .filter((order) => cancellationState(order) === "pending")
    .map((order) => {
      const request = readCancellationRequest(order);
      return {
        id: order.id,
        order_no: order.order_no,
        consignee_name: consigneeField(order.consignee, ["name", "full_name"]),
        requested_at: request?.requested_at ?? order.updated_at,
        reason: request?.reason ?? null,
      };
    })
    .sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1))
    .slice(0, 50);

  return { cancellations: pending, count: pending.length };
}
