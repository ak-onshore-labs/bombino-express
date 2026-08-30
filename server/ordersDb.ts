import { supabase } from "./supabaseClient.js";
import type { Order } from "../shared/orderContract.js";

type Json = Record<string, unknown> | unknown[] | null;

function logSupabaseError(operation: string, error: { message?: string; code?: string } | null): void {
  console.error("[ordersDb] supabase operation failed (non-fatal):", {
    operation,
    message: error?.message,
    code: error?.code,
  });
}

function getSupabaseClient() {
  if (!supabase) {
    console.error("[ordersDb] supabase client is not configured");
    return null;
  }
  return supabase;
}

export type PickupRequest = 1 | 2;
export type PaymentMethod = "pay_now" | "pay_at_pickup" | "pay_at_dropoff" | "cod";

export type OrderInsert = {
  user_id: string;
  status: string;
  pickup_request: PickupRequest;
  pickup_date: string | null;
  origin_address_id: string;
  consignee: Json;
  items: Json;
  booked_weight: number | null;
  quoted_amount: number | null;
  packaging_required: boolean;
  payment_method: PaymentMethod;
  is_cod: boolean;
};

export type OrderRow = {
  id: string;
  order_no: string;
  user_id: string;
  status: string;
  pickup_request: number;
  pickup_date: string | null;
  origin_address_id: string | null;
  consignee: Json;
  items: Json;
  booked_weight: number | null;
  quoted_amount: number | null;
  packaging_required: boolean;
  payment_method: string;
  payment_status: string;
  is_cod: boolean;
  agent_id: string | null;
  actual_weight: number | null;
  final_amount: number | null;
  awb_no: string | null;
  created_at: string;
  updated_at: string;
};

export async function insertOrderAndReturnRow(input: OrderInsert): Promise<OrderRow | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .insert(input)
    .select(
      "id, order_no, user_id, status, pickup_request, pickup_date, origin_address_id, consignee, items, booked_weight, quoted_amount, packaging_required, payment_method, payment_status, is_cod, agent_id, actual_weight, final_amount, awb_no, created_at, updated_at"
    )
    .single();

  if (error) {
    logSupabaseError("insertOrderAndReturnRow", error);
    return null;
  }
  return data as OrderRow;
}

export async function insertOrderEvent(input: {
  order_id: string;
  status: string;
  note?: string | null;
  actor_user_id?: string | null;
  metadata?: Json;
}): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { error } = await client.from("order_events").insert({
    order_id: input.order_id,
    status: input.status,
    note: input.note ?? null,
    actor_user_id: input.actor_user_id ?? null,
    metadata: input.metadata ?? null,
  });

  if (error) {
    logSupabaseError("insertOrderEvent", error);
    return false;
  }
  return true;
}

const ORDER_COLUMNS =
  "id, order_no, user_id, status, pickup_request, pickup_date, origin_address_id, consignee, items, booked_weight, quoted_amount, packaging_required, payment_method, payment_status, is_cod, agent_id, actual_weight, final_amount, awb_no, metadata, created_at, updated_at";

/**
 * Narrow a DB row to the shared `Order` contract.
 *
 * The DB columns are `text`/`smallint`/`numeric`; the contract is unions. The
 * CHECK constraints already guarantee the values, so this is a re-assertion at
 * the boundary rather than validation — but an unknown status is returned as-is
 * and will simply match no transition, which fails closed.
 */
export function toOrder(row: OrderRow & { metadata?: unknown }): Order {
  return {
    ...row,
    status: row.status as Order["status"],
    pickup_request: row.pickup_request === 2 ? 2 : 1,
    // Explicit rather than carried by the spread: a projection written before
    // the column existed hands us `undefined`, and the contract says boolean.
    packaging_required: row.packaging_required === true,
    payment_method: row.payment_method as Order["payment_method"],
    payment_status: row.payment_status as Order["payment_status"],
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

/** Single order by id. Returns null when missing or on DB error. */
export async function getOrderById(orderId: string): Promise<Order | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    logSupabaseError("getOrderById", error);
    return null;
  }
  if (!data) return null;
  return toOrder(data as unknown as OrderRow);
}

/**
 * The pickup address, embedded via the orders → addresses FK.
 *
 * Same embed the agent uses (`agentDb.PICKUP_ADDRESS_EMBED`) — the customer
 * needs it for the mirror-image reason: to confirm the address they gave is
 * the one an agent will turn up at.
 */
const ORIGIN_ADDRESS_EMBED =
  "origin_address:addresses(id, full_name, company, phone, email, address_line_1, address_line_2, city, state, pincode, country_code, country_name)";

export type OrderAddress = {
  id: string;
  full_name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country_code: string | null;
  country_name: string | null;
};

export type OrderWithAddress = Order & { origin_address: OrderAddress | null };

/**
 * One order, by its human-facing number, scoped to its owner.
 *
 * `user_id` is in the WHERE clause rather than checked in JS afterwards: the
 * service-role key bypasses RLS, so this predicate *is* the authorisation
 * boundary (§4.2 of open-items). A mismatched owner returns null, which the
 * route reports as 404 — an ownership failure and a missing row are
 * indistinguishable to the caller by design.
 */
export async function getOrderByNumberForUser(
  orderNo: string,
  userId: string
): Promise<OrderWithAddress | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .select(`${ORDER_COLUMNS}, ${ORIGIN_ADDRESS_EMBED}`)
    .eq("order_no", orderNo)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logSupabaseError("getOrderByNumberForUser", error);
    return null;
  }
  if (!data) return null;

  const row = data as unknown as OrderRow & { origin_address?: OrderAddress | null };
  return { ...toOrder(row), origin_address: row.origin_address ?? null };
}

/**
 * Record a customer's request that their order be cancelled.
 *
 * Writes `metadata.cancellation_request` and moves nothing else. The order
 * keeps its status, the agent keeps the job, and ops decides — see the
 * cancellation block in `orderLifecycle.ts` for why the customer only asks.
 *
 * Read-then-write, unavoidably: `metadata` is a whole jsonb value to PostgREST,
 * so merging a key means reading the object first. That mirrors what A4 already
 * does (`attachRazorpayOrderId`), and the same caveat applies — a concurrent
 * write to a *different* metadata key can be lost. Acceptable here because the
 * competing writers are a payment attempt and a cancellation request on the
 * same order within the same instant, and the losing key is recoverable from
 * `order_events`. Promote to `jsonb_set` in a Postgres function if that stops
 * being true.
 *
 * The preconditions that matter are still in the WHERE clause: the caller must
 * own the order and it must still be in a status a request makes sense from.
 *
 * @returns the updated order, or null when the order moved on, is not theirs,
 *          or the DB errored — all of which mean "your request did not land"
 */
export async function recordCancellationRequest(input: {
  orderId: string;
  userId: string;
  expectedStatuses: readonly string[];
  reason: string | null;
}): Promise<Order | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data: current, error: readError } = await client
    .from("orders")
    .select("metadata")
    .eq("id", input.orderId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (readError) {
    logSupabaseError("recordCancellationRequest:read", readError);
    return null;
  }
  if (!current) return null;

  const metadata = {
    ...((current.metadata as Record<string, unknown> | null) ?? {}),
    cancellation_request: {
      requested_at: new Date().toISOString(),
      requested_by: input.userId,
      reason: input.reason,
    },
  };

  const { data, error } = await client
    .from("orders")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", input.orderId)
    .eq("user_id", input.userId)
    // A parcel already collected cannot be un-requested into existence. If the
    // agent moved it between the guard and here, the request is refused rather
    // than written against a status nobody will act on.
    .in("status", [...input.expectedStatuses])
    .select(ORDER_COLUMNS)
    .maybeSingle();

  if (error) {
    logSupabaseError("recordCancellationRequest:update", error);
    return null;
  }
  if (!data) return null;
  return toOrder(data as unknown as OrderRow);
}

/**
 * Ops answering a request: approved or declined.
 *
 * Approval is recorded *alongside* the status move, not instead of it — the
 * order row stays the truth about being cancelled (see `cancellationState`),
 * and this only records who decided and when, which is the first thing anyone
 * asks a week later.
 *
 * A decline moves nothing. The order carries on and the customer may ask again,
 * because `cancellationState` reads a rejected request as closed.
 *
 * Same read-then-write caveat as `recordCancellationRequest`. Deliberately not
 * guarded on status: ops approving a cancellation flips the status first, so by
 * the time this runs the order is already `cancelled` and any status
 * precondition here would reject its own caller.
 *
 * @returns true when the decision was written; false on a missing order or a
 *          DB error. Never fatal to the caller — the decision itself already
 *          landed in `orders.status` and `order_events`.
 */
export async function markCancellationRequestDecided(input: {
  orderId: string;
  decision: "approved" | "rejected";
  decidedBy: string;
  note: string | null;
}): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { data: current, error: readError } = await client
    .from("orders")
    .select("metadata")
    .eq("id", input.orderId)
    .maybeSingle();

  if (readError) {
    logSupabaseError("markCancellationRequestDecided:read", readError);
    return false;
  }
  if (!current) return false;

  const metadata = (current.metadata as Record<string, unknown> | null) ?? {};
  const request = metadata.cancellation_request;
  // Ops cancelling an order nobody asked about. There is no request to decide,
  // and inventing one would put words in the customer's mouth.
  if (!request || typeof request !== "object" || Array.isArray(request)) return false;

  const { error } = await client
    .from("orders")
    .update({
      metadata: {
        ...metadata,
        cancellation_request: {
          ...(request as Record<string, unknown>),
          status: input.decision,
          decided_at: new Date().toISOString(),
          decided_by: input.decidedBy,
          decision_note: input.note,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.orderId);

  if (error) {
    logSupabaseError("markCancellationRequestDecided:update", error);
    return false;
  }
  return true;
}

/**
 * Every order of this customer's that cancellation has touched — asked about,
 * declined, or cancelled outright.
 *
 * A separate query rather than a filter over `listOrdersByUserId` because the
 * predicate is a jsonb key, and pulling every order to the client to test it
 * there would send a customer's whole history to render one short list.
 *
 * `metadata` is selected here and nowhere else in the list projections: this is
 * the one screen whose entire subject lives inside it.
 */
export async function listCancellationOrdersByUserId(
  userId: string
): Promise<OrderRow[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("user_id", userId)
    // Either a request was made, or the order is cancelled — ops can cancel
    // without a request, and the customer still needs to see that it happened.
    .or("metadata->cancellation_request.not.is.null,status.eq.cancelled")
    .order("updated_at", { ascending: false });

  if (error) {
    logSupabaseError("listCancellationOrdersByUserId", error);
    return null;
  }
  return (data ?? []) as OrderRow[];
}

export type OrderEventRow = {
  id: string;
  order_id: string;
  status: string;
  note: string | null;
  actor_user_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/** Lifecycle log for one order, oldest first — the order it happened in. */
export async function listOrderEvents(orderId: string): Promise<OrderEventRow[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("order_events")
    .select("id, order_id, status, note, actor_user_id, metadata, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (error) {
    logSupabaseError("listOrderEvents", error);
    return null;
  }
  return (data ?? []) as OrderEventRow[];
}

export type OrderPaymentRow = {
  id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  collected_by: string | null;
  collected_at: string | null;
  reference: string | null;
  created_at: string;
};

/**
 * Money recorded against an order. COD never produces a row — an empty list is
 * not the same as "unpaid" (see the header of migrations/create_payments.sql).
 */
export async function listPaymentsByOrderId(orderId: string): Promise<OrderPaymentRow[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("payments")
    .select("id, amount, currency, method, status, collected_by, collected_at, reference, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (error) {
    logSupabaseError("listPaymentsByOrderId", error);
    return null;
  }
  return (data ?? []) as OrderPaymentRow[];
}

export type StaffContact = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: string | null;
};

/**
 * Names for the user ids appearing on an order's events and payments, so the
 * customer reads "Collected by Ravi" instead of a UUID. Returns a map rather
 * than a list because every caller looks up by id.
 */
export async function getUserContactsByIds(ids: string[]): Promise<Map<string, StaffContact>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();

  const client = getSupabaseClient();
  if (!client) return new Map();

  const { data, error } = await client
    .from("itd_users")
    .select("id, full_name, phone, role")
    .in("id", unique);

  if (error) {
    logSupabaseError("getUserContactsByIds", error);
    return new Map();
  }
  return new Map((data as StaffContact[]).map((u) => [u.id, u]));
}

export async function listOrdersByUserId(userId: string): Promise<OrderRow[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .select(
      "id, order_no, user_id, status, pickup_request, pickup_date, origin_address_id, consignee, items, booked_weight, quoted_amount, packaging_required, payment_method, payment_status, is_cod, agent_id, actual_weight, final_amount, awb_no, created_at, updated_at"
    )
    .eq("user_id", userId)
    // Most recently moved first — an order the agent just advanced should lead.
    .order("updated_at", { ascending: false });

  if (error) {
    logSupabaseError("listOrdersByUserId", error);
    return null;
  }
  return (data ?? []) as OrderRow[];
}
