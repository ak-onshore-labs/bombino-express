/**
 * Reward points: reading and writing `reward_ledger`.
 *
 * Rules are in shared/rewards.ts; the plan is docs/rewards/rewards-plan.md.
 *
 * Phase 1, step 1 is earning only:
 *   · `landPoints` writes the `earn` row when an account order is paid and
 *     dispatched. Called from the order fan-out (notify.ts), so every way an
 *     order reaches `dispatched` goes through it.
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
  RUPEES_PER_POINT,
  canRedeem,
  fyLastDay,
  fyOf,
  gstPerOf,
  milestoneProgress,
  pointsEarned,
  type RewardLedgerKind,
  type RewardsSummary,
} from "../shared/rewards.js";
import { isPaymentSatisfied, type Order } from "../shared/orderContract.js";

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
  "id, order_no, user_id, guest_ref, status, payment_method, payment_status, is_cod, booked_weight, actual_weight, quoted_amount, final_amount, metadata";

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
};

/**
 * Whether an order can earn at all: booked by an account. A guest booking
 * keeps its guest_ref after a later signup claims it, so the claim does not
 * make it eligible.
 */
export function earnsRewards(order: Pick<EarnOrderRow, "user_id" | "guest_ref">): boolean {
  return !!order.user_id && !order.guest_ref;
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
 * Points used on an order (step 2 writes these as `reward_points` payment
 * rows). None exist yet; read now so earning is right the day they do.
 */
async function pointsUsedOn(orderId: string): Promise<number> {
  const client = getClient();
  if (!client) return 0;
  const { data, error } = await client
    .from("payments")
    .select("amount, status")
    .eq("order_id", orderId)
    .eq("method", "reward_points");
  if (error) {
    logDbError("rewardsDb", "pointsUsedOn", error);
    return 0;
  }
  let rupees = 0;
  for (const row of data ?? []) {
    if (row.status === "collected") rupees += Number(row.amount) || 0;
  }
  return Math.round(rupees / RUPEES_PER_POINT);
}

/**
 * Write the `earn` row for an order that is now paid and dispatched.
 *
 * Idempotent: the unique index on (order_id, kind) makes a second call a
 * no-op, so it is safe to fire on every transition. An order that earns 0
 * points still gets a row, so its weight counts toward the milestone.
 *
 * Never throws; a failure here must not disturb the dispatch.
 */
export async function landPoints(orderId: string): Promise<void> {
  try {
    const client = getClient();
    if (!client) return;

    const { data, error } = await client
      .from("orders")
      .select(EARN_COLUMNS)
      .eq("id", orderId)
      .maybeSingle();
    if (error || !data) {
      if (error) logDbError("rewardsDb", "landPoints:order", error);
      return;
    }
    const order = data as unknown as EarnOrderRow;

    if (!earnsRewards(order) || order.status !== "dispatched") return;
    // Settle already demands this; checked again so nothing lands unpaid.
    // COD counts as satisfied, as it does at settle (assumption, see plan).
    if (!isPaymentSatisfied(order as unknown as Order)) return;

    const billed = billedInclGst(order);
    if (billed == null) {
      console.warn("[rewardsDb] dispatched order has no amount — no points landed", {
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
      metadata: { billed_incl_gst: billed, gst_per: gstPer, points_used: used },
    });
    if (insertError && insertError.code !== UNIQUE_VIOLATION) {
      logError("landPoints:insert", insertError);
    }
  } catch (err) {
    console.error("[rewardsDb] landPoints failed", { order_id: orderId, err });
  }
}

/**
 * Run after any order transition. Lands points on dispatch; nothing else in
 * step 1 (cancel needs no row, because pending points are not stored).
 */
export async function rewardsOnTransition(order: Pick<Order, "id" | "status">): Promise<void> {
  if (order.status === "dispatched") await landPoints(order.id);
}

type LedgerRow = {
  id: string;
  order_id: string | null;
  kind: RewardLedgerKind;
  points: number;
  weight_kg: number | string;
  fy: string;
  note: string | null;
  created_at: string;
};

/** Open orders: still on their way to paid and dispatched. */
const CLOSED_STATUSES = ["dispatched", "cancelled"];

/**
 * Everything the rewards screen shows, for one account.
 *
 * Returns null only when the database cannot be reached. A missing ledger
 * table reads as an empty ledger.
 */
export async function rewardsSummaryFor(userId: string, now: Date = new Date()): Promise<RewardsSummary | null> {
  const client = getClient();
  if (!client) return null;

  const fy = fyOf(now);

  const [ledgerRes, openRes] = await Promise.all([
    client
      .from("reward_ledger")
      .select("id, order_id, kind, points, weight_kg, fy, note, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    client
      .from("orders")
      .select("id, order_no, user_id, guest_ref, status, quoted_amount, final_amount, metadata")
      .eq("user_id", userId)
      .is("guest_ref", null)
      .not("status", "in", `(${CLOSED_STATUSES.join(",")})`),
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
  for (const row of ledger) {
    balance += Number(row.points) || 0;
    if (row.fy === fy) kgThisFy += Number(row.weight_kg) || 0;
  }

  const pendingOrders = ((openRes.data ?? []) as unknown as EarnOrderRow[])
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
    })),
  };
}
