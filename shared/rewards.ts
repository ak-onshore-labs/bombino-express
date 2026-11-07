/**
 * Reward points: the rules, as pure functions. Shared by server and client.
 *
 * Phase 1 is points only (docs/rewards/rewards-plan.md):
 *
 *   · Earn: ₹100 billed before GST = 1 point, per order, rounded down.
 *     "Billed" is the price before GST minus any points used on the order.
 *   · Points land when the parcel is DELIVERED (changed 7 Nov; was paid and
 *     dispatched). Until then they are pending ("on the way") and cannot be
 *     used. A parcel that ends any other way (returned, lost, abandoned,
 *     cancelled by the carrier) never earns.
 *   · Use: ₹1 per point, only once the balance is 100 or more.
 *   · Year = Indian financial year (Apr–Mar). Every unused point expires at
 *     midnight 31 Mar, whenever it was earned.
 *   · One weight milestone per FY. No ₹ milestone, no tier ladder.
 *
 * Constants live here rather than in env vars, on purpose.
 */

import { nowInIst } from "./istTime.js";

/**
 * Orders booked before this IST date never earn (open question E: no
 * backfill). Points only start with rewards going live; change this one
 * constant if Bombino wants earlier orders to count.
 */
export const EARN_FROM_BOOKING_DATE = "2026-11-07";

/** Whether an order booked at `createdAt` is new enough to earn. */
export function bookedInRewardsEra(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && t >= new Date(`${EARN_FROM_BOOKING_DATE}T00:00:00+05:30`).getTime();
}

/** Rupees billed (before GST) per point earned. */
export const RUPEES_PER_EARNED_POINT = 100;
/** Rupees a point is worth when used. */
export const RUPEES_PER_POINT = 1;
/** Points can only be used once the balance reaches this. */
export const MIN_REDEEM_POINTS = 100;
/** The one milestone: kg shipped in a financial year. */
export const MILESTONE_KG = 700;
/**
 * GST on freight when the order did not record ITD's rate (orders booked
 * before the split was kept, or quotes ITD could not check).
 */
export const DEFAULT_GST_PER = 18;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Financial year of an instant, in India: "2026-27" runs from 00:00 IST
 * 1 Apr 2026 to 23:59:59 IST 31 Mar 2027.
 */
export function fyOf(at: Date = new Date()): string {
  const { date } = nowInIst(at);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** First calendar year of an FY label: "2026-27" → 2026. */
function fyStartYear(fy: string): number {
  const start = Number(fy.slice(0, 4));
  if (!/^\d{4}-\d{2}$/.test(fy) || !Number.isFinite(start)) {
    throw new Error(`Not a financial year label: ${fy}`);
  }
  return start;
}

/** Last day of an FY, `YYYY-MM-DD` (31 Mar). Points expire at the end of it. */
export function fyLastDay(fy: string): string {
  return `${fyStartYear(fy) + 1}-03-31`;
}

/** The instant points of this FY expire: 00:00 IST 1 Apr after it. */
export function fyExpiresAtIso(fy: string): string {
  return new Date(`${fyStartYear(fy) + 1}-04-01T00:00:00+05:30`).toISOString();
}

/** A GST-inclusive amount with the GST taken out. */
export function exGst(amountInclGst: number, gstPer: number): number {
  const rate = Number.isFinite(gstPer) && gstPer >= 0 ? gstPer : DEFAULT_GST_PER;
  return round2(amountInclGst / (1 + rate / 100));
}

/**
 * GST rate from an order's metadata (`metadata.gst_per`, kept at booking from
 * ITD's rate row), or the default.
 */
export function gstPerOf(metadata: unknown): number {
  const raw =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>).gst_per
      : undefined;
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 50 ? n : DEFAULT_GST_PER;
}

/**
 * Points an order earns.
 *
 * `billedInclGst` is what the order costs with GST (final amount after the
 * hub weighs it, else the booking quote). GST is charged on the full price,
 * so the points used come off the price before GST:
 * billed = exGst(total) − points used.
 */
export function pointsEarned(input: {
  billedInclGst: number | null;
  gstPer: number;
  pointsUsed?: number;
}): number {
  const total = input.billedInclGst;
  if (total == null || !Number.isFinite(total) || total <= 0) return 0;
  const used = Math.max(0, input.pointsUsed ?? 0) * RUPEES_PER_POINT;
  const billed = round2(exGst(total, input.gstPer) - used);
  if (billed <= 0) return 0;
  return Math.floor(billed / RUPEES_PER_EARNED_POINT);
}

/** True when the balance is high enough to use any points. */
export function canRedeem(balance: number): boolean {
  return balance >= MIN_REDEEM_POINTS;
}

/** Where a customer is against the year's weight milestone. */
export type MilestoneProgress = {
  shippedKg: number;
  targetKg: number;
  remainingKg: number;
  reached: boolean;
  /** 0–1, for a progress bar. */
  progress: number;
};

export function milestoneProgress(shippedKg: number, targetKg: number = MILESTONE_KG): MilestoneProgress {
  const shipped = round2(Math.max(0, Number.isFinite(shippedKg) ? shippedKg : 0));
  const reached = shipped >= targetKg;
  return {
    shippedKg: shipped,
    targetKg,
    remainingKg: reached ? 0 : round2(targetKg - shipped),
    reached,
    progress: targetKg > 0 ? Math.min(1, shipped / targetKg) : 1,
  };
}

/**
 * What a carrier tracking state means for an order's points. ITD's
 * `event_state` vocabulary (see client/src/lib/awbStatus.ts):
 *
 *   "delivered" → the points land.
 *   "never"     → the parcel will not be delivered; it never earns.
 *   null        → still on its way (or a failed attempt that will be retried).
 */
export type DeliveryOutcome = "delivered" | "never";

const NEVER_DELIVERED = new Set(["RTO", "PART RTO", "CANCELLED", "ABANDONED", "LOST"]);

export function deliveryOutcome(state: string | null | undefined): DeliveryOutcome | null {
  const key = (state ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  if (!key) return null;
  if (key === "DELIVERED") return "delivered";
  if (NEVER_DELIVERED.has(key)) return "never";
  return null;
}

/** Ledger row kinds. Pending points are not rows: they are worked out from open orders. */
export const REWARD_LEDGER_KINDS = [
  "earn",
  /** 0 points: the parcel ended without being delivered, so it never earns. */
  "forfeit",
  "redeem",
  "redeem_back",
  "clawback",
  "expiry",
  "adjust",
] as const;
export type RewardLedgerKind = (typeof REWARD_LEDGER_KINDS)[number];

/** What `GET /api/rewards` answers. */
export type RewardsSummary = {
  fy: string;
  /** `YYYY-MM-DD`, the last day points of this FY can be used. */
  fyLastDay: string;
  /** Spendable points. Can be negative after a clawback. */
  balance: number;
  canRedeem: boolean;
  minRedeemPoints: number;
  rupeesPerPoint: number;
  /** Points on the way: orders that will earn once delivered. */
  pending: { points: number; orders: { orderId: string; orderNo: string; points: number }[] };
  milestone: MilestoneProgress;
  history: {
    id: string;
    kind: RewardLedgerKind;
    points: number;
    orderId: string | null;
    orderNo: string | null;
    note: string | null;
    createdAt: string;
    /** Ops console only: who made a manual adjustment. */
    createdByName?: string | null;
  }[];
};
