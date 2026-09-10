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
  /** The account that booked. Null on a guest booking — see guest_ref. */
  user_id?: string | null;
  /**
   * The guest who booked, identified by the ref their documents were staged
   * under (the signup flow's signup_ref, reused). Set together with the guest
   * contact fields; null for an account booking.
   */
  guest_ref?: string | null;
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
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
  /**
   * Booking stamps `kyc_verified` here — informational only. KYC never holds
   * an order or a docket; it is Cashfree Smart OCR's verdict, kept for display.
   */
  metadata?: Json;
};

export type OrderRow = {
  id: string;
  order_no: string;
  user_id: string | null;
  guest_ref?: string | null;
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
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

  // ORDER_COLUMNS rather than a hand-copied list, which is what this was and
  // which had silently drifted: it omitted `metadata`, so the row handed back
  // from a booking always looked as though it had none, whatever the order had
  // just been stamped with.
  const { data, error } = await client
    .from("orders")
    .insert(input)
    .select(ORDER_COLUMNS)
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
  "id, order_no, user_id, guest_ref, guest_name, guest_email, guest_phone, status, pickup_request, pickup_date, origin_address_id, consignee, items, booked_weight, quoted_amount, packaging_required, payment_method, payment_status, is_cod, agent_id, actual_weight, final_amount, awb_no, metadata, created_at, updated_at";

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

/**
 * Record the AWB an order was docketed with **at booking**.
 *
 * Deliberately not `opsDb.applyGenerateDocket`, which is the other half of the
 * same idea and cannot serve this one: it hardcodes `status = 'settled'` in its
 * WHERE and moves the order to `dispatched`. Neither is right here. A docket
 * issued at booking says only that ITD now holds this shipment — the parcel is
 * still in the customer's house, has not been collected, weighed or paid for,
 * and must walk the ordinary lifecycle exactly as it would have.
 *
 * So this writes `awb_no` and `itd_docket_response` and **touches nothing
 * else**. What it keeps from the ops version is the guard that matters:
 * `awb_no IS NULL`, in the UPDATE rather than in a prior read, so two requests
 * racing on the same order cannot both file a docket. A zero-row result means
 * one already exists, which the caller treats as "somebody got there first"
 * rather than an error — the ITD call has happened either way and its AWB is
 * already on the row.
 */
export async function applyBookingDocket(input: {
  orderId: string;
  awbNo: string;
  docketResponse: unknown;
}): Promise<OrderRow | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .update({
      awb_no: input.awbNo,
      itd_docket_response: input.docketResponse,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.orderId)
    .is("awb_no", null)
    .select(ORDER_COLUMNS)
    .maybeSingle();

  if (error) {
    logSupabaseError("applyBookingDocket", error);
    return null;
  }
  return (data as unknown as OrderRow | null) ?? null;
}

/**
 * Stamp why an at-booking docket did not happen, so ops can see it.
 *
 * The order itself is already committed and perfectly valid — it simply has no
 * AWB yet, which is the state every guest and local-account order is in anyway.
 * The difference is that this one was *expected* to have one, and without a
 * record of the attempt that expectation is invisible: the order would sit on
 * the board looking exactly like an ordinary pre-docket booking, and nobody
 * would know ITD had refused it.
 *
 * Read-then-write for the same reason `refreshKycVerifiedOnOpenOrders` below
 * does it — `metadata` is one whole jsonb value to PostgREST, so the other keys
 * on it have to be carried across by hand.
 *
 * Best-effort by contract: returns a boolean and throws nothing. A booking must
 * never fail because the note about a failed docket could not be written.
 */
export async function recordBookingDocketError(
  orderId: string,
  detail: { stage: string; message: string }
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { data: row, error: readError } = await client
    .from("orders")
    .select("metadata")
    .eq("id", orderId)
    .maybeSingle();

  if (readError) {
    logSupabaseError("recordBookingDocketError:read", readError);
    return false;
  }

  const metadata = ((row?.metadata as Record<string, unknown> | null) ?? {});

  const { error } = await client
    .from("orders")
    .update({
      metadata: {
        ...metadata,
        docket_error: {
          at: new Date().toISOString(),
          stage: detail.stage,
          message: detail.message,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (error) {
    logSupabaseError("recordBookingDocketError:update", error);
    return false;
  }
  return true;
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

/**
 * Re-stamp `metadata.kyc_verified` across a customer's open orders.
 *
 * Called when their document set changes — typically the moment the last one
 * comes back verified. Without it an order booked while unverified keeps a
 * stale `false` and stays held after the customer has done everything asked of
 * them, which reads to ops as a system that ignores its own queue.
 *
 * Scoped to orders that have not finished (`status NOT IN (dispatched,
 * cancelled)`): past those two nothing reads the flag and rewriting history
 * buys nothing.
 *
 * This used to be scoped on `awb_no IS NULL` instead, which meant the same
 * thing while an AWB could only be issued at the very end. It cannot any more —
 * an ITD-credentialled account is docketed at booking (see
 * `applyBookingDocket`), so such an order carries an AWB from its first minute
 * and would otherwise keep a stale `kyc_verified: false` for its whole life.
 *
 * Read-then-write per row for the same reason `recordCancellationRequest`
 * does it — `metadata` is one whole jsonb value to PostgREST. Same caveat, and
 * a narrower blast radius: the competing writer would have to touch a different
 * key on the same order in the same instant.
 *
 * Best-effort by contract: it returns a count and throws nothing. The caller is
 * an upload handler, and a customer whose document saved should not see a 500
 * because a bookkeeping update lost a race.
 */
export async function refreshKycVerifiedOnOpenOrders(
  userId: string,
  verified: boolean
): Promise<number> {
  const client = getSupabaseClient();
  if (!client) return 0;

  const OPEN_STATUSES = ["dispatched", "cancelled"];

  const { data: rows, error: readError } = await client
    .from("orders")
    .select("id, metadata")
    .eq("user_id", userId)
    .not("status", "in", `(${OPEN_STATUSES.join(",")})`);

  if (readError) {
    logSupabaseError("refreshKycVerifiedOnOpenOrders:read", readError);
    return 0;
  }

  let updated = 0;
  for (const row of rows ?? []) {
    const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
    if (metadata.kyc_verified === verified) continue;

    const { error } = await client
      .from("orders")
      .update({
        metadata: { ...metadata, kyc_verified: verified },
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .not("status", "in", `(${OPEN_STATUSES.join(",")})`);

    if (error) {
      logSupabaseError("refreshKycVerifiedOnOpenOrders:update", error);
      continue;
    }
    updated += 1;
  }
  return updated;
}

/**
 * Attach a guest's past bookings to the account that number has just opened.
 *
 * Matched on the verified phone, which is the only thing the two sides share:
 * the guest proved it by OTP to book, and the account proved it by OTP to
 * exist. Anything a guest wrote alongside the order — the pickup address, the
 * payments, the KYC document — is moved with it, so the new account owns a
 * whole order rather than a shell pointing at rows it cannot read.
 *
 * `guest_ref` is deliberately NOT cleared. It is the record of how the order
 * arrived, and clearing it would make a claimed order indistinguishable from
 * one booked by the account itself.
 *
 * Best-effort and idempotent: the filter is `user_id IS NULL`, so a partial
 * run leaves the rest claimable and a second run is a no-op. A failure must
 * never fail the signup that triggered it — the customer has an account
 * either way, and an unclaimed order is still tracked by its number.
 */
export async function claimGuestOrdersForUser(
  phone: string,
  userId: string
): Promise<{ orders: number; refs: string[] }> {
  const client = getSupabaseClient();
  if (!client) return { orders: 0, refs: [] };

  const { data, error } = await client
    .from("orders")
    .update({ user_id: userId })
    .eq("guest_phone", phone)
    .is("user_id", null)
    .select("id, guest_ref");

  if (error) {
    logSupabaseError("claimGuestOrdersForUser", error);
    return { orders: 0, refs: [] };
  }

  const rows = (data ?? []) as Array<{ id: string; guest_ref: string | null }>;
  const refs = Array.from(
    new Set(rows.map((r) => r.guest_ref).filter((r): r is string => !!r))
  );
  if (refs.length === 0) return { orders: rows.length, refs: [] };

  // The rows that hang off those orders. Each is independent — one failing
  // does not undo the claim, and the next signup attempt would pick it up.
  // Many rows per account, so a plain update is enough. Notifications go too:
  // the bell a guest had is the bell the account opens with.
  for (const [table, label] of [
    ["addresses", "addresses"],
    ["payments", "payments"],
    ["notifications", "notifications"],
  ] as const) {
    const { error: err } = await client
      .from(table)
      .update({ user_id: userId })
      .in("guest_ref", refs)
      .is("user_id", null);
    if (err) logSupabaseError(`claimGuestOrdersForUser:${label}`, err);
  }

  // kyc_documents is ONE row per account (kyc_documents_user_id_key), so it
  // cannot be claimed the same way.
  //
  // The naive update collided with the row signup had just written and was
  // logged rather than applied, leaving the guest's row behind with user_id
  // NULL: an encrypted Aadhaar owned by nobody, which a retention sweep keyed
  // on "user_id IS NULL" would then read as a live guest's.
  //
  // Both rows are the same person's document, so the question is only which
  // one the account keeps:
  //
  //   account has no row   promote the newest guest row. Promoting rather than
  //                        copying keeps its capability_id, which is the URL
  //                        already handed out for that document.
  //   account has a row    the guest rows are superseded by the one the
  //                        customer just uploaded at signup. Delete them; a
  //                        duplicate identity document kept for no reader is
  //                        exactly what the retention work is trying to avoid.
  await claimGuestKycDocument(client, refs, userId);

  return { orders: rows.length, refs };
}

/**
 * Settle the one-row-per-account KYC document when a guest's orders are claimed.
 *
 * Separated from the loop above because it is not a bulk update: the target
 * table admits a single row per user, so this decides between two rows rather
 * than moving both.
 *
 * Best-effort like the rest of the claim — the account and its orders are
 * already correct by the time this runs, and a failure here leaves a row that
 * the next claim on the same number picks up.
 */
async function claimGuestKycDocument(
  client: NonNullable<ReturnType<typeof getSupabaseClient>>,
  refs: string[],
  userId: string
): Promise<void> {
  const { data: guestRows, error: readErr } = await client
    .from("kyc_documents")
    .select("id, created_at")
    .in("guest_ref", refs)
    .is("user_id", null)
    .order("created_at", { ascending: false });

  if (readErr) {
    logSupabaseError("claimGuestOrdersForUser:kyc_documents:read", readErr);
    return;
  }
  const rows = (guestRows ?? []) as Array<{ id: string }>;
  if (rows.length === 0) return;

  const { data: existing, error: ownErr } = await client
    .from("kyc_documents")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (ownErr) {
    logSupabaseError("claimGuestOrdersForUser:kyc_documents:owner", ownErr);
    return;
  }

  // Newest first from the query above, so rows[0] is the one worth keeping.
  const promote = existing ? null : rows[0];
  const discard = rows.filter((r) => r.id !== promote?.id).map((r) => r.id);

  if (promote) {
    const { error } = await client
      .from("kyc_documents")
      .update({ user_id: userId })
      .eq("id", promote.id);
    if (error) {
      logSupabaseError("claimGuestOrdersForUser:kyc_documents:promote", error);
      return;
    }
  }

  if (discard.length > 0) {
    const { error } = await client.from("kyc_documents").delete().in("id", discard);
    if (error) logSupabaseError("claimGuestOrdersForUser:kyc_documents:discard", error);
  }
}
