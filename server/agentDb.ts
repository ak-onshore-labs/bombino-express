/**
 * A5 — Pickup Agent database operations.
 *
 * The rule this whole file exists to enforce: **every precondition lives in the
 * WHERE clause.** The guards in `orderLifecycle.ts` decide which buttons to
 * show and reject obvious nonsense early, but they run against a row that was
 * read moments earlier, so two callers can both pass them. Only the conditional
 * UPDATE is atomic, and only it decides who actually won.
 *
 * A concrete consequence: nothing here does read-then-write. Every mutation is
 * one statement whose WHERE re-asserts the state it expects, and a zero-row
 * result is a normal, expected answer meaning "someone else got there first" —
 * not an error.
 *
 * RLS is bypassed everywhere (service-role key), so the WHERE clause is also
 * the only authorisation boundary. `agent_id = :agentId` is load-bearing.
 */

import { supabase } from "./supabaseClient.js";
import { toOrder, type OrderRow } from "./ordersDb.js";
import type { Order, OrderStatus } from "../shared/orderContract.js";

const ORDER_COLUMNS =
  "id, order_no, user_id, status, pickup_request, pickup_date, origin_address_id, consignee, items, booked_weight, quoted_amount, packaging_required, payment_method, payment_status, is_cod, agent_id, actual_weight, final_amount, awb_no, metadata, created_at, updated_at";

/**
 * The pickup address, embedded via the orders → addresses FK.
 *
 * The agent cannot do the job without it: `items.shipper_city` carries a city
 * and a name but no street, and the order row itself has only
 * `origin_address_id`. Embedding costs one join and saves a round trip per
 * card on a phone that may be on bad network.
 */
const PICKUP_ADDRESS_EMBED =
  "origin_address:addresses(id, full_name, company, phone, email, address_line_1, address_line_2, city, state, pincode, country_code)";

const PICKUP_COLUMNS = `${ORDER_COLUMNS}, ${PICKUP_ADDRESS_EMBED}`;

export type PickupAddress = {
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
};

/** An order as the agent sees it — the row plus where to collect it. */
export type AgentPickup = Order & { origin_address: PickupAddress | null };

function toAgentPickup(row: OrderRow & { origin_address?: PickupAddress | null }): AgentPickup {
  return {
    ...toOrder(row),
    origin_address: row.origin_address ?? null,
  };
}

function logSupabaseError(
  operation: string,
  error: { message?: string; code?: string } | null
): void {
  console.error("[agentDb] supabase operation failed:", {
    operation,
    message: error?.message,
    code: error?.code,
  });
}

function getSupabaseClient() {
  if (!supabase) {
    console.error("[agentDb] supabase client is not configured");
    return null;
  }
  return supabase;
}

/**
 * Jobs nobody has claimed. Oldest first — the queue is FIFO so a pickup cannot
 * sit at the bottom of every agent's list forever.
 *
 * Returns null on DB error, distinct from `[]` which means "none available".
 * Callers must not collapse the two: an empty screen and a broken screen say
 * different things to someone standing in the street.
 */
export async function getAvailablePickups(): Promise<AgentPickup[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .select(PICKUP_COLUMNS)
    .eq("status", "pickup_requested")
    .is("agent_id", null)
    .order("created_at", { ascending: true });

  if (error) {
    logSupabaseError("getAvailablePickups", error);
    return null;
  }
  return (data as unknown as (OrderRow & { origin_address?: PickupAddress | null })[]).map(
    toAgentPickup
  );
}

/**
 * The caller's own live jobs.
 *
 * `received_at_hub` is excluded because that is the handoff: the parcel is with
 * ops and the agent can no longer act on it (§5). Terminal states are excluded
 * for the same reason — a cancelled or dispatched order is not work.
 *
 * So are the three ops states that follow the handoff — `weighed`, `settled`,
 * `ready_for_docket`. They were missed, and the effect was worse than an extra
 * row: an order that had reached the hub weeks ago stayed in the agent's list
 * for ever, showing as OVERDUE against its old pickup date, with no action on
 * it because the lifecycle has none left for an agent at that point. The list
 * is what the agent still has to do, and a settled parcel is not that.
 */
export async function getMyPickups(agentId: string): Promise<AgentPickup[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .select(PICKUP_COLUMNS)
    .eq("agent_id", agentId)
    .not(
      "status",
      "in",
      "(received_at_hub,weighed,settled,ready_for_docket,dispatched,cancelled)"
    )
    .order("pickup_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    logSupabaseError("getMyPickups", error);
    return null;
  }
  return (data as unknown as (OrderRow & { origin_address?: PickupAddress | null })[]).map(
    toAgentPickup
  );
}

/**
 * Claim an unclaimed pickup. The race-safe one.
 *
 * Both racing agents pass the `isUnclaimed` guard — it read a stale row. This
 * single UPDATE is what separates them: the second one blocks on the first's
 * row lock, re-evaluates its WHERE against the now-committed row, matches zero
 * rows and returns null. Exactly one winner, under READ COMMITTED, with no
 * explicit transaction and no advisory lock.
 *
 * `.maybeSingle()` rather than `.single()` deliberately — losing the race is
 * an ordinary outcome, not a PGRST116 exception to catch.
 *
 * @returns the claimed row, or null if another agent won (or the DB errored —
 *          both mean "you did not get it", which is all the caller can act on)
 */
export async function claimPickup(
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
    // Both conditions matter. `status` alone would let an agent re-claim a job
    // another agent had already moved back; `agent_id` alone would let a claim
    // land on an order that had since been cancelled.
    .eq("status", "pickup_requested")
    .is("agent_id", null)
    .select(ORDER_COLUMNS)
    .maybeSingle();

  if (error) {
    logSupabaseError("claimPickup", error);
    return null;
  }
  if (!data) return null;
  return toOrder(data as unknown as OrderRow);
}

/**
 * Move one of the caller's own jobs from `expectedFrom` to `to`.
 *
 * `agent_id = agentId` in the WHERE is what stops one agent advancing another
 * agent's parcel — it is a security check, not an optimisation, because the
 * service-role key means nothing else is enforcing it.
 *
 * `expectedFrom` makes the write idempotent under a double-tap: the second tap
 * finds the order already moved, matches nothing, and returns null rather than
 * writing a duplicate event.
 *
 * @returns the updated row, or null if the order was not in `expectedFrom`,
 *          not held by this agent, or the DB errored
 */
export async function advanceOrderStatus(input: {
  orderId: string;
  agentId: string;
  expectedFrom: OrderStatus;
  to: OrderStatus;
}): Promise<Order | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .update({ status: input.to, updated_at: new Date().toISOString() })
    .eq("id", input.orderId)
    .eq("status", input.expectedFrom)
    .eq("agent_id", input.agentId)
    .select(ORDER_COLUMNS)
    .maybeSingle();

  if (error) {
    logSupabaseError("advanceOrderStatus", error);
    return null;
  }
  if (!data) return null;
  return toOrder(data as unknown as OrderRow);
}

/**
 * Move an order to a status with no agent-ownership requirement — currently
 * only `cancel`, which a customer performs on their own order and ops performs
 * on anyone's. Ownership is checked by the caller; the status precondition is
 * still enforced here.
 */
export async function transitionOrderStatus(input: {
  orderId: string;
  expectedFrom: OrderStatus;
  to: OrderStatus;
}): Promise<Order | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .update({ status: input.to, updated_at: new Date().toISOString() })
    .eq("id", input.orderId)
    .eq("status", input.expectedFrom)
    .select(ORDER_COLUMNS)
    .maybeSingle();

  if (error) {
    logSupabaseError("transitionOrderStatus", error);
    return null;
  }
  if (!data) return null;
  return toOrder(data as unknown as OrderRow);
}

// ── Payment collection ────────────────────────────────────────────────────

/** How the money physically moved, as opposed to what the customer chose. */
export type CollectionMode = "upi" | "cash";

export type PaymentInsert = {
  order_id: string;
  user_id: string;
  amount: number;
  method: "pay_at_pickup" | "pay_at_dropoff";
  status: "collected";
  collection_mode: CollectionMode;
  collected_by: string;
  reference?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type CollectionRow = {
  id: string;
  txn_id: string | null;
  order_id: string;
  amount: number;
  collection_mode: CollectionMode | null;
  collected_at: string | null;
  reference: string | null;
  order_no: string | null;
};

/**
 * Record cash taken at the door.
 *
 * Two writes that ought to be one transaction — the `payments` row and the
 * `orders.payment_status` flip. supabase-js cannot express a multi-statement
 * transaction, so this does them in the order that fails safe: the payment row
 * first, the flag second. A crash between them leaves a recorded payment on an
 * order still marked `pending`, which reconciliation can find and fix. The
 * reverse order would lose the money entirely.
 *
 * Promote to a Postgres function when A4 lands and this path stops being the
 * only writer.
 */
export async function recordCollectedPayment(
  input: PaymentInsert
): Promise<{ paymentId: string; txnId: string | null; order: Order | null } | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data: payment, error: paymentError } = await client
    .from("payments")
    .insert({
      order_id: input.order_id,
      user_id: input.user_id,
      amount: input.amount,
      method: input.method,
      status: input.status,
      collection_mode: input.collection_mode,
      collected_by: input.collected_by,
      reference: input.reference ?? null,
      metadata: input.metadata ?? null,
      collected_at: new Date().toISOString(),
    })
    // txn_id is generated by a column DEFAULT, so it has to be read back
    // rather than composed here — the sequence is the only thing that can
    // guarantee uniqueness across concurrent agents.
    .select("id, txn_id")
    .single();

  if (paymentError || !payment) {
    logSupabaseError("recordCollectedPayment:insert", paymentError);
    return null;
  }

  // Guarded so a concurrent A4 webhook that already marked this paid is not
  // stomped back to a lesser state.
  const { data: order, error: orderError } = await client
    .from("orders")
    .update({ payment_status: "paid", updated_at: new Date().toISOString() })
    .eq("id", input.order_id)
    .neq("payment_status", "paid")
    .select(ORDER_COLUMNS)
    .maybeSingle();

  if (orderError) {
    // The money is recorded; only the flag is stale. Loud, because it needs
    // reconciling by hand.
    console.error(
      "[agentDb] payment recorded but orders.payment_status not updated — reconcile manually:",
      { order_id: input.order_id, payment_id: payment.id, error: orderError.message }
    );
  }

  return {
    paymentId: payment.id as string,
    txnId: (payment.txn_id as string | null) ?? null,
    order: order ? toOrder(order as unknown as OrderRow) : null,
  };
}

/**
 * Money this agent has taken today, newest first.
 *
 * "Today" is Asia/Kolkata, matching the txn id's date prefix — an agent
 * reconciling their pouch at the end of a shift must see the same set of
 * payments the ids imply.
 */
export async function getCollectionsToday(agentId: string): Promise<CollectionRow[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  // Start of the current IST day, expressed as an instant.
  const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const startIso = new Date(
    Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate()) -
      5.5 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await client
    .from("payments")
    .select("id, txn_id, order_id, amount, collection_mode, collected_at, reference, orders(order_no)")
    .eq("collected_by", agentId)
    .gte("collected_at", startIso)
    .order("collected_at", { ascending: false });

  if (error) {
    logSupabaseError("getCollectionsToday", error);
    return null;
  }

  return (data ?? []).map((row) => {
    const r = row as unknown as Omit<CollectionRow, "order_no"> & {
      orders?: { order_no?: string } | null;
    };
    return {
      id: r.id,
      txn_id: r.txn_id,
      order_id: r.order_id,
      amount: Number(r.amount),
      collection_mode: r.collection_mode,
      collected_at: r.collected_at,
      reference: r.reference,
      order_no: r.orders?.order_no ?? null,
    };
  });
}
