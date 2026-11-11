/**
 * Reward points: reading and writing `reward_ledger`.
 *
 * Rules are in shared/rewards.ts; the plan is docs/rewards/rewards-plan.md.
 *
 * Earning:
 *   · `landPoints` writes the `earn` row when an account order's parcel is
 *     DELIVERED (changed 7 Nov; was on dispatch). Delivery is learnt from ITD
 *     tracking: whenever anyone reads it (`rewardsOnTrackingState`) and from
 *     the six-hourly check in rewardsDelivery.ts. A parcel that ends any other
 *     way gets a 0-point `forfeit` row instead.
 *   · Test orders (TEST AWBs, never filed with ITD) land at dispatch.
 *   · Pending points are not stored. `rewardsSummaryFor` works them out from
 *     the customer's open orders, so a cancelled order simply stops showing
 *     them; nothing has to be reversed.
 *
 * WORDING: an order "lands" its points. Never say "settle" here — `settled` is
 * an order status (after weighing) and means something else.
 *
 * Every function is safe to call before migrations/create_reward_ledger.sql
 * has been applied: a missing table reads as "no points" and is logged once.
 */

import { dbClient, logDbError, type DbError } from "./db/client.js";
import {
  MIN_REDEEM_POINTS,
  EARN_FROM_BOOKING_DATE,
  RUPEES_PER_POINT,
  canRedeem,
  fyLastDay,
  fyOf,
  gstPerOf,
  bookedInRewardsEra,
  deliveryOutcome,
  milestoneProgress,
  pointsDueBack,
  pointsEarned,
  type RewardLedgerKind,
  type RewardsSummary,
} from "../shared/rewards.js";
import { isPaymentSatisfied, type Order } from "../shared/orderContract.js";
import { getUserContactsByIds } from "./ordersDb.js";
import { isTestAwb } from "../shared/testOrders.js";

const UNIQUE_VIOLATION = "23505";

let missingTableLogged = false;

function isMissingTable(error: DbError): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function logError(operation: string, error: DbError): void {
  if (isMissingTable(error)) {
    if (!missingTableLogged) {
      missingTableLogged = true;
      console.warn(
        "[rewardsDb] reward_ledger does not exist yet — run migrations/create_reward_ledger.sql. " +
          "Until then nobody earns points."
      );
    }
    return;
  }
  logDbError("rewardsDb", operation, error);
}

const getClient = () => dbClient("rewardsDb");

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The order columns earning needs. Read fresh: callers' Order shapes vary. */
const EARN_COLUMNS =
  "id, order_no, user_id, guest_ref, status, payment_method, payment_status, is_cod, booked_weight, actual_weight, quoted_amount, final_amount, metadata, created_at";

type EarnOrderRow = {
  id: string;
  order_no: string;
  user_id: string | null;
  guest_ref: string | null;
  status: string;
  payment_method: string;
  payment_status: string;
  is_cod: boolean;
  booked_weight: number | string | null;
  actual_weight: number | string | null;
  quoted_amount: number | string | null;
  final_amount: number | string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Whether an order can earn at all: booked by an account. A guest booking
 * keeps its guest_ref after a later signup claims it, so the claim does not
 * make it eligible.
 */
export function earnsRewards(order: Pick<EarnOrderRow, "user_id" | "guest_ref" | "created_at">): boolean {
  return !!order.user_id && !order.guest_ref && bookedInRewardsEra(order.created_at);
}

/** Amount the order costs with GST: the hub's price once weighed, else the quote. */
function billedInclGst(order: Pick<EarnOrderRow, "final_amount" | "quoted_amount">): number | null {
  return num(order.final_amount) ?? num(order.quoted_amount);
}

/** Kg the order counts toward the milestone: hub weight, else booked weight. */
function shippedKg(order: Pick<EarnOrderRow, "actual_weight" | "booked_weight">): number {
  return num(order.actual_weight) ?? num(order.booked_weight) ?? 0;
}

/**
 * Points used on an order and points already given back, from the ledger:
 * `redeem` rows (negative) and `redeem_back` rows (positive) for the order.
 */
async function pointsMovementOn(orderId: string): Promise<{ used: number; returned: number } | null> {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client
    .from("reward_ledger")
    .select("kind, points")
    .eq("order_id", orderId)
    .in("kind", ["redeem", "redeem_back"]);
  if (error) {
    logError("pointsMovementOn", error);
    return isMissingTable(error) ? { used: 0, returned: 0 } : null;
  }
  let used = 0;
  let returned = 0;
  for (const r of data ?? []) {
    const n = Number(r.points) || 0;
    if (r.kind === "redeem") used += -n;
    else returned += n;
  }
  return { used, returned };
}

/** Points still applied to an order (used less given back). */
async function pointsUsedOn(orderId: string): Promise<number> {
  const m = await pointsMovementOn(orderId);
  return m ? Math.max(0, m.used - m.returned) : 0;
}

/**
 * Spendable balance: the sum of this year's ledger rows (`fyOf`). Rows from
 * an earlier year no longer count, which is the 31 Mar expiry.
 */
export async function balanceOf(userId: string): Promise<number | null> {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client
    .from("reward_ledger")
    .select("points")
    .eq("user_id", userId)
    .eq("fy", fyOf());
  if (error) {
    logError("balanceOf", error);
    return isMissingTable(error) ? 0 : null;
  }
  return (data ?? []).reduce((sum, r) => sum + (Number(r.points) || 0), 0);
}

async function setPointsUsedOnOrder(orderId: string, points: number): Promise<void> {
  const client = getClient();
  if (!client) return;
  const { data, error } = await client.from("orders").select("metadata").eq("id", orderId).maybeSingle();
  if (error || !data) {
    if (error) logDbError("rewardsDb", "setPointsUsedOnOrder:read", error);
    return;
  }
  const metadata = { ...((data.metadata as Record<string, unknown> | null) ?? {}), reward_points_used: points };
  const { error: writeError } = await client
    .from("orders")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", orderId);
  if (writeError) logDbError("rewardsDb", "setPointsUsedOnOrder:write", writeError);
}

/**
 * Take `points` off the customer's balance for this order: one `redeem` row.
 * The order already carries `metadata.reward_points_used` from the insert.
 * On failure the order's copy is cleared, so the customer is asked for the
 * full price rather than getting a discount nothing paid for.
 *
 * ACCEPTED RACE: two bookings in the same instant can both pass the balance
 * check and take the balance below zero. supabase-js has no transaction; the
 * window is a double tap across two tabs, and a negative balance is already a
 * state the rules allow (new points fill it first).
 */
export async function redeemOnOrder(input: { userId: string; orderId: string; points: number }): Promise<boolean> {
  const client = getClient();
  if (!client || input.points <= 0) return false;
  const { error } = await client.from("reward_ledger").insert({
    user_id: input.userId,
    order_id: input.orderId,
    kind: "redeem",
    points: -Math.floor(input.points),
    weight_kg: 0,
    fy: fyOf(),
    metadata: { rupees: Math.floor(input.points) * RUPEES_PER_POINT },
  });
  if (error) {
    logError("redeemOnOrder", error);
    await setPointsUsedOnOrder(input.orderId, 0);
    return false;
  }
  return true;
}

/**
 * Give points back when they no longer belong on the order: all of them on a
 * cancel, and any beyond the new price after a lighter reweigh (points never
 * become cash). Writes one `redeem_back` row for whatever is still owed back
 * and lowers the order's copy. Idempotent: it compares with what has already
 * gone back.
 *
 * Returns the points still applied to the order, for the payment flag.
 */
export async function settlePointsOnOrder(order: {
  id: string;
  user_id: string | null;
  status: string;
  dueInclGst: number | null;
}): Promise<number> {
  const m = await pointsMovementOn(order.id);
  if (!m || m.used === 0 || !order.user_id) return m ? Math.max(0, m.used - m.returned) : 0;

  const owedBack = pointsDueBack({ status: order.status, dueInclGst: order.dueInclGst, pointsUsedGross: m.used });
  const delta = owedBack - m.returned;
  if (delta > 0) {
    const client = getClient();
    if (!client) return Math.max(0, m.used - m.returned);
    const { error } = await client.from("reward_ledger").insert({
      user_id: order.user_id,
      order_id: order.id,
      kind: "redeem_back",
      points: delta,
      weight_kg: 0,
      fy: fyOf(),
      note: order.status === "cancelled" ? "Order cancelled" : "Price went down at the hub",
    });
    if (error) {
      logError("settlePointsOnOrder", error);
      return Math.max(0, m.used - m.returned);
    }
    await setPointsUsedOnOrder(order.id, m.used - owedBack);
    return Math.max(0, m.used - owedBack);
  }
  return Math.max(0, m.used - m.returned);
}

/** Whether this order already earned or forfeited: either closes it for good. */
async function isClosedForRewards(orderId: string): Promise<boolean> {
  const client = getClient();
  if (!client) return true;
  const { data, error } = await client
    .from("reward_ledger")
    .select("id")
    .eq("order_id", orderId)
    .in("kind", ["earn", "forfeit"])
    .limit(1);
  if (error) {
    logError("isClosedForRewards", error);
    return true; // unknown: write nothing rather than risk a double row
  }
  return (data ?? []).length > 0;
}

async function readEarnOrder(where: { id?: string; awb?: string }): Promise<EarnOrderRow | null> {
  const client = getClient();
  if (!client) return null;
  let q = client.from("orders").select(EARN_COLUMNS);
  q = where.id ? q.eq("id", where.id) : q.eq("awb_no", where.awb ?? "");
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) {
    logDbError("rewardsDb", "readEarnOrder", error);
    return null;
  }
  return (data as unknown as EarnOrderRow | null) ?? null;
}

/**
 * Write the `earn` row for an order whose parcel has been DELIVERED.
 *
 * Idempotent: the unique index on (order_id, kind) makes a second call a
 * no-op, so it is safe to fire every time tracking is read. An order that
 * earns 0 points still gets a row, so its weight counts toward the milestone.
 *
 * Never throws; a failure here must not disturb tracking or a dispatch.
 */
export async function landPoints(orderId: string, deliveredState = "DELIVERED"): Promise<void> {
  try {
    const client = getClient();
    if (!client) return;
    const order = await readEarnOrder({ id: orderId });
    if (!order) return;

    if (!earnsRewards(order) || order.status !== "dispatched") return;
    // Settle already demands this; checked again so nothing lands unpaid.
    // COD counts as satisfied, as it does at settle (assumption, see plan).
    if (!isPaymentSatisfied(order as unknown as Order)) return;
    if (await isClosedForRewards(order.id)) return;

    const billed = billedInclGst(order);
    if (billed == null) {
      console.warn("[rewardsDb] delivered order has no amount — no points landed", {
        order_id: order.id,
      });
      return;
    }

    const used = await pointsUsedOn(order.id);
    const gstPer = gstPerOf(order.metadata);
    const points = pointsEarned({ billedInclGst: billed, gstPer, pointsUsed: used });

    const { error: insertError } = await client.from("reward_ledger").insert({
      user_id: order.user_id,
      order_id: order.id,
      kind: "earn",
      points,
      weight_kg: shippedKg(order),
      fy: fyOf(),
      metadata: { billed_incl_gst: billed, gst_per: gstPer, points_used: used, tracking_state: deliveredState },
    });
    if (insertError && insertError.code !== UNIQUE_VIOLATION) {
      logError("landPoints:insert", insertError);
    }
  } catch (err) {
    console.error("[rewardsDb] landPoints failed", { order_id: orderId, err });
  }
}

/**
 * The parcel ended without being delivered (returned to origin, lost,
 * abandoned, cancelled by the carrier): record a 0-point `forfeit` so the
 * order stops showing as "on the way" and the delivery check stops asking.
 */
export async function forfeitPoints(orderId: string, state: string): Promise<void> {
  try {
    const client = getClient();
    if (!client) return;
    const order = await readEarnOrder({ id: orderId });
    if (!order || !earnsRewards(order) || order.status !== "dispatched") return;
    if (await isClosedForRewards(order.id)) return;
    const { error } = await client.from("reward_ledger").insert({
      user_id: order.user_id,
      order_id: order.id,
      kind: "forfeit",
      points: 0,
      weight_kg: 0,
      fy: fyOf(),
      note: `Not delivered (${state})`,
      metadata: { tracking_state: state },
    });
    if (error && error.code !== UNIQUE_VIOLATION) logError("forfeitPoints:insert", error);
  } catch (err) {
    console.error("[rewardsDb] forfeitPoints failed", { order_id: orderId, err });
  }
}

/**
 * Carrier tracking was just read for an AWB (a customer or ops opening
 * tracking, the parcel page, or the delivery check). Lands or forfeits the
 * order's points when the state is final. Fire-and-forget; never throws.
 */
export async function rewardsOnTrackingState(awb: string, state: string | null | undefined): Promise<void> {
  const outcome = deliveryOutcome(state);
  if (!outcome || !awb.trim()) return;
  const order = await readEarnOrder({ awb: awb.trim() });
  if (!order || !earnsRewards(order) || order.status !== "dispatched") return;
  if (outcome === "delivered") await landPoints(order.id, String(state).trim().toUpperCase());
  else await forfeitPoints(order.id, String(state).trim().toUpperCase());
}

/**
 * Run after any order transition. Real parcels earn on delivery (tracking),
 * not here. A TEST order's AWB is never filed with ITD, so it would never be
 * "delivered": it lands at dispatch instead, so the team can try rewards end
 * to end on test phones.
 */
export async function rewardsOnTransition(order: Pick<Order, "id" | "status" | "awb_no">): Promise<void> {
  if (order.status === "dispatched" && isTestAwb(order.awb_no)) await landPoints(order.id, "TEST_DISPATCHED");
  // Points used on a cancelled order go back. The payment reconcile does this
  // too; both are idempotent, this one covers any cancel path that skips it.
  if (order.status === "cancelled") {
    const row = await readEarnOrder({ id: order.id });
    if (row?.user_id) {
      await settlePointsOnOrder({ id: row.id, user_id: row.user_id, status: row.status, dueInclGst: billedInclGst(row) });
    }
  }
}

/** Largest single manual adjustment, either way. A typo guard, not a policy. */
export const MAX_ADJUST_POINTS = 100_000;

/**
 * Add (positive) or take away (negative) points by hand. Super admin only —
 * the route checks `rewards.adjust`. The reason is required and kept on the
 * row with who made it; there is no edit or delete, a mistake is undone by
 * another adjustment.
 *
 * Returns false when the write failed (including a missing table).
 */
export async function addAdjustment(input: {
  userId: string;
  points: number;
  note: string;
  staffUserId: string;
}): Promise<boolean> {
  const client = getClient();
  if (!client) return false;
  const { error } = await client.from("reward_ledger").insert({
    user_id: input.userId,
    order_id: null,
    kind: "adjust",
    points: input.points,
    weight_kg: 0,
    fy: fyOf(),
    note: input.note,
    created_by: input.staffUserId,
  });
  if (error) {
    logError("addAdjustment", error);
    return false;
  }
  return true;
}

/** One ledger row as the accounts export needs it. */
export type LedgerExportRow = {
  id: string;
  created_at: string;
  user_id: string;
  order_id: string | null;
  kind: RewardLedgerKind;
  points: number;
  weight_kg: number;
  fy: string;
  note: string | null;
  created_by: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Every ledger row in one IST calendar month (`YYYY-MM`), oldest first, for
 * the monthly export to accounts. ITD never learns about points, so this is
 * the only record of what they were worth.
 *
 * Null when the database cannot be reached; [] when the table is missing.
 */
export async function listLedgerForMonth(month: string): Promise<LedgerExportRow[] | null> {
  const client = getClient();
  if (!client) return null;

  const [y, m] = month.split("-").map(Number);
  const start = new Date(`${month}-01T00:00:00+05:30`).toISOString();
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const end = new Date(`${nextMonth}-01T00:00:00+05:30`).toISOString();

  const rows: LedgerExportRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("reward_ledger")
      .select("id, created_at, user_id, order_id, kind, points, weight_kg, fy, note, created_by, metadata")
      .gte("created_at", start)
      .lt("created_at", end)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      logError("listLedgerForMonth", error);
      return isMissingTable(error) ? [] : null;
    }
    const page = (data ?? []) as LedgerExportRow[];
    rows.push(...page.map((r) => ({ ...r, points: Number(r.points) || 0, weight_kg: Number(r.weight_kg) || 0 })));
    if (page.length < PAGE) break;
  }
  return rows;
}

type LedgerRow = {
  id: string;
  order_id: string | null;
  kind: RewardLedgerKind;
  points: number;
  weight_kg: number | string;
  fy: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
};


/**
 * Everything the rewards screen shows, for one account.
 *
 * Returns null only when the database cannot be reached. A missing ledger
 * table reads as an empty ledger.
 *
 * `forStaff` adds who made each manual adjustment (ops console only; the
 * customer never sees staff names).
 */
export async function rewardsSummaryFor(
  userId: string,
  options: { now?: Date; forStaff?: boolean } = {}
): Promise<RewardsSummary | null> {
  const now = options.now ?? new Date();
  const client = getClient();
  if (!client) return null;

  const fy = fyOf(now);

  const [ledgerRes, openRes] = await Promise.all([
    client
      .from("reward_ledger")
      .select("id, order_id, kind, points, weight_kg, fy, note, created_by, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    client
      .from("orders")
      .select("id, order_no, user_id, guest_ref, status, quoted_amount, final_amount, metadata, created_at")
      .eq("user_id", userId)
      .is("guest_ref", null)
      .neq("status", "cancelled")
      .gte("created_at", new Date(`${EARN_FROM_BOOKING_DATE}T00:00:00+05:30`).toISOString()),
  ]);

  let ledger: LedgerRow[] = [];
  if (ledgerRes.error) {
    logError("rewardsSummaryFor:ledger", ledgerRes.error);
    if (!isMissingTable(ledgerRes.error)) return null;
  } else {
    ledger = (ledgerRes.data ?? []) as LedgerRow[];
  }

  if (openRes.error) {
    logDbError("rewardsDb", "rewardsSummaryFor:orders", openRes.error);
    return null;
  }

  let balance = 0;
  let kgThisFy = 0;
  // Only this year's rows count: earlier years expired as 31 Mar began. The
  // history below still lists every row.
  for (const row of ledger) {
    if (row.fy !== fy) continue;
    balance += Number(row.points) || 0;
    kgThisFy += Number(row.weight_kg) || 0;
  }

  // On the way = not cancelled, and not yet earned or forfeited (delivered,
  // or ended undelivered). Dispatched parcels stay here until delivery.
  const closed = new Set(
    ledger.filter((r) => r.kind === "earn" || r.kind === "forfeit").map((r) => r.order_id)
  );
  const pendingOrders = ((openRes.data ?? []) as unknown as EarnOrderRow[])
    .filter((o) => !closed.has(o.id))
    .map((o) => ({
      orderId: o.id,
      orderNo: o.order_no,
      points: pointsEarned({ billedInclGst: billedInclGst(o), gstPer: gstPerOf(o.metadata) }),
    }))
    .filter((o) => o.points > 0);

  // Order numbers for the history list.
  const orderIds = Array.from(
    new Set(ledger.map((r) => r.order_id).filter((id): id is string => !!id))
  ).slice(0, 200);
  const orderNos = new Map<string, string>();
  if (orderIds.length > 0) {
    const { data, error } = await client.from("orders").select("id, order_no").in("id", orderIds);
    if (error) logDbError("rewardsDb", "rewardsSummaryFor:orderNos", error);
    for (const o of data ?? []) orderNos.set(o.id as string, o.order_no as string);
  }

  const staffNames = new Map<string, string>();
  if (options.forStaff) {
    const ids = ledger.map((r) => r.created_by).filter((id): id is string => !!id);
    for (const [id, c] of await getUserContactsByIds(ids)) staffNames.set(id, c.full_name ?? "Staff");
  }

  return {
    fy,
    fyLastDay: fyLastDay(fy),
    balance,
    canRedeem: canRedeem(balance),
    minRedeemPoints: MIN_REDEEM_POINTS,
    rupeesPerPoint: RUPEES_PER_POINT,
    pending: {
      points: pendingOrders.reduce((sum, o) => sum + o.points, 0),
      orders: pendingOrders,
    },
    milestone: milestoneProgress(kgThisFy),
    history: ledger.slice(0, 100).map((r) => ({
      id: r.id,
      kind: r.kind,
      points: Number(r.points) || 0,
      orderId: r.order_id,
      orderNo: r.order_id ? (orderNos.get(r.order_id) ?? null) : null,
      note: r.note,
      createdAt: r.created_at,
      ...(options.forStaff
        ? { createdByName: r.created_by ? (staffNames.get(r.created_by) ?? "Staff") : null }
        : {}),
    })),
  };
}
