/**
 * Keeping orders in step with ITD's tracking.
 *
 * Our order status only moves when someone at Bombino presses a button. ITD
 * moves the parcel regardless: an order docketed at booking can be scanned,
 * flown and delivered while our row still says `received_at_hub` because ops
 * never weighed, settled or marked it dispatched (BOM-100347, Nov 2026). The
 * customer saw "Arrived at Bombino hub" on Orders and "Delivered" when they
 * tracked the AWB, and the ops board kept it in the hub queue.
 *
 * ITD is the truth about where the parcel is, so:
 *
 *   1. The order lists (customer, guest, receiver, ops) carry ITD's latest
 *      scan as `carrier_status`, and the screens show it.
 *   2. Once ITD has scanned the parcel past the booking entry, an order still
 *      short of `dispatched` is moved to `dispatched` automatically, logged as
 *      `itd_sync`. Nothing is blocked: weight, payment and docket checks are
 *      the hub's to do, and ops can still record them by hand afterwards.
 *
 * Source: the `tracking_events` cache every tracking read fills. AWBs whose
 * cached answer is stale (or missing) and not final are asked again, a few at
 * a time; a request waits a short while for those answers and returns what it
 * has. A late answer still lands in the cache for the next read. A sweep
 * (`startCarrierSyncTimer`) catches the orders nobody is looking at.
 */

import { deliveryOutcome } from "../shared/rewards.js";
import { isTestAwb } from "../shared/testOrders.js";
import { carrierHasParcel, type CarrierStatus } from "../shared/carrierState.js";
import type { Order, OrderStatus } from "../shared/orderContract.js";
import { dbClient, logDbError } from "./db/client.js";
import { itdClient } from "./itd.js";
import { updateShipmentTrackingStatus, upsertTrackingEvents } from "./appDb.js";
import { rewardsOnTrackingState } from "./rewardsDb.js";
import { transitionOrderStatus } from "./agentDb.js";
import { insertOrderEvent } from "./ordersDb.js";
import { notifyOrderTransition } from "./notify.js";

export type { CarrierStatus };

/**
 * Ask ITD again once our last answer for an AWB is this old. Same cadence as
 * the tracking screen's own poll (useAwbTracking, 2 min), so the order lists
 * are never further behind ITD than tracking is.
 */
const REFRESH_AFTER_MS = 2 * 60 * 1000;
/** How long a list request waits for fresh ITD answers before replying. */
const WAIT_BUDGET_MS = 2500;
/** Most ITD calls one list request may start. The rest wait for the next read. */
const MAX_REFRESH_PER_CALL = 15;
/** AWBs per cache query, so one customer's events stay under PostgREST's row cap. */
const CACHE_CHUNK = 20;

/** When this process last asked ITD about an AWB (success or not). */
const lastAsked = new Map<string, number>();
const inFlight = new Map<string, Promise<CarrierStatus | null>>();

/** The latest scan by event time. Events with no state are skipped. */
export function latestScan(events: unknown[]): CarrierStatus | null {
  let best: { t: number; state: string; at: string } | null = null;
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const e = ev as Record<string, unknown>;
    const state = typeof e.event_state === "string" ? e.event_state.trim() : "";
    if (!state) continue;
    const at = typeof e.event_at === "string" ? e.event_at : "";
    const parsed = at ? new Date(at).getTime() : NaN;
    const t = Number.isFinite(parsed) ? parsed : -Infinity;
    if (!best || t >= best.t) best = { t, state, at };
  }
  return best ? { state: best.state, at: best.at } : null;
}

/** ITD will send nothing more for this AWB. */
function isFinal(state: string | null | undefined): boolean {
  return deliveryOutcome(state) !== null;
}

/** Statuses an ITD scan can move on: everything short of the end. */
function isBeforeDispatch(status: string): boolean {
  return status !== "dispatched" && status !== "cancelled";
}

/** Whether an order in this status, with ITD at this state, should be moved to dispatched. */
export function shouldAutoDispatch(status: string, carrier: CarrierStatus | null | undefined): boolean {
  return isBeforeDispatch(status) && carrierHasParcel(carrier?.state);
}

async function readCached(awbs: string[]): Promise<Map<string, CarrierStatus>> {
  const out = new Map<string, CarrierStatus>();
  const client = dbClient("carrierStatus");
  if (!client || awbs.length === 0) return out;

  for (let i = 0; i < awbs.length; i += CACHE_CHUNK) {
    const chunk = awbs.slice(i, i + CACHE_CHUNK);
    const { data, error } = await client
      .from("tracking_events")
      .select("awb_number, event_at, event_state:raw_event->>event_state")
      .in("awb_number", chunk);
    if (error) {
      logDbError("carrierStatus", "tracking_events", error);
      continue;
    }
    const byAwb = new Map<string, unknown[]>();
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const awb = String(row.awb_number ?? "");
      if (!awb) continue;
      const list = byAwb.get(awb) ?? [];
      list.push(row);
      byAwb.set(awb, list);
    }
    byAwb.forEach((events, awb) => {
      const latest = latestScan(events);
      if (latest) out.set(awb, latest);
    });
  }
  return out;
}

/** One ITD call per AWB at a time; the answer also fills the cache and rewards. */
function askItd(awb: string): Promise<CarrierStatus | null> {
  const pending = inFlight.get(awb);
  if (pending) return pending;
  lastAsked.set(awb, Date.now());
  const p = (async () => {
    try {
      const results = await itdClient.trackShipment(awb);
      const events = (results?.[0]?.docket_events ?? []) as unknown[];
      void upsertTrackingEvents(awb, events);
      const latest = latestScan(events);
      // The shipments list reads `shipments.current_status`; keep it in step
      // the way a tracking-screen read does.
      if (latest) void updateShipmentTrackingStatus(awb, latest.state, new Date().toISOString());
      // Same as any other tracking read: a final state lands or forfeits points.
      void rewardsOnTrackingState(awb, latest?.state ?? null);
      return latest;
    } catch (err) {
      console.error("[carrierStatus] tracking failed", {
        awb,
        err: err instanceof Error ? err.message : err,
      });
      return null;
    } finally {
      inFlight.delete(awb);
    }
  })();
  inFlight.set(awb, p);
  return p;
}

/**
 * ITD's latest state for each AWB, from the cache, refreshed where stale.
 * Test AWBs are never asked about (ITD has never heard of them).
 */
export async function carrierStatusesFor(
  awbsIn: readonly (string | null | undefined)[],
  opts: { maxRefresh?: number; waitMs?: number } = {}
): Promise<Map<string, CarrierStatus>> {
  const awbs = Array.from(
    new Set(awbsIn.map((a) => (a ?? "").trim()).filter((a) => a && !isTestAwb(a)))
  );
  const statuses = await readCached(awbs);

  const now = Date.now();
  const stale = awbs
    .filter((awb) => !isFinal(statuses.get(awb)?.state))
    .filter((awb) => now - (lastAsked.get(awb) ?? 0) > REFRESH_AFTER_MS)
    .slice(0, opts.maxRefresh ?? MAX_REFRESH_PER_CALL);
  if (stale.length === 0) return statuses;

  const asks = stale.map((awb) =>
    askItd(awb).then((fresh) => {
      if (fresh) statuses.set(awb, fresh);
    })
  );
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled(asks),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, opts.waitMs ?? WAIT_BUDGET_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
  // Copied so answers arriving after the reply cannot change what was sent.
  return new Map(statuses);
}

/**
 * Move the order behind this AWB to `dispatched` when ITD has the parcel and
 * we have not caught up. Returns the moved order, or null when nothing moved.
 *
 * Guarded on the status we read (optimistic, like every transition), so a
 * staff action or a second reader landing first simply wins. The customer is
 * told the parcel shipped only while it is still on its way; a parcel ITD has
 * already delivered (or returned) gets no late "on its way" message, just its
 * reward points.
 */
export async function syncOrderWithCarrier(
  awbIn: string | null | undefined,
  carrier: CarrierStatus | null | undefined
): Promise<Order | null> {
  const awb = (awbIn ?? "").trim();
  if (!awb || isTestAwb(awb) || !carrier || !carrierHasParcel(carrier.state)) return null;
  const client = dbClient("carrierStatus");
  if (!client) return null;

  const { data, error } = await client
    .from("orders")
    .select("id, status")
    .eq("awb_no", awb)
    .not("status", "in", "(dispatched,cancelled)");
  if (error) {
    logDbError("carrierStatus", "orders", error);
    return null;
  }

  let moved: Order | null = null;
  for (const row of (data ?? []) as { id: string; status: string }[]) {
    const updated = await transitionOrderStatus({
      orderId: row.id,
      expectedFrom: row.status as OrderStatus,
      to: "dispatched",
    });
    if (!updated) continue;
    moved = updated;

    await insertOrderEvent({
      order_id: updated.id,
      status: "dispatched",
      note: `Dispatched automatically: ITD tracking shows "${carrier.state}" for AWB ${awb}`,
      actor_user_id: null,
      metadata: {
        action: "itd_sync",
        from_status: row.status,
        itd_state: carrier.state,
        itd_event_at: carrier.at || null,
      },
    });
    console.log("[carrierStatus] auto-dispatched", {
      order_no: updated.order_no,
      from: row.status,
      itd_state: carrier.state,
    });

    if (isFinal(carrier.state)) {
      // Already delivered/returned: points land (or forfeit) now that it is dispatched.
      void rewardsOnTrackingState(awb, carrier.state);
    } else {
      void notifyOrderTransition({ order: updated, moved: true, actorUserId: null });
    }
  }
  return moved;
}

/**
 * The same rows with `carrier_status` attached, and any order ITD has already
 * taken moved to `dispatched` first (the row comes back with the new status).
 * Cancelled orders and orders with no AWB get null.
 */
export async function withCarrierStatus<T extends { status: string; awb_no: string | null }>(
  rows: T[]
): Promise<(T & { carrier_status: CarrierStatus | null })[]> {
  const tracked = rows.filter((r) => r.awb_no && r.status !== "cancelled");
  const statuses = await carrierStatusesFor(tracked.map((r) => r.awb_no));

  const out: (T & { carrier_status: CarrierStatus | null })[] = [];
  for (const r of rows) {
    const carrier =
      r.awb_no && r.status !== "cancelled" ? statuses.get(r.awb_no.trim()) ?? null : null;
    if (shouldAutoDispatch(r.status, carrier)) {
      const moved = await syncOrderWithCarrier(r.awb_no, carrier);
      if (moved) {
        out.push({ ...r, status: moved.status, updated_at: moved.updated_at, carrier_status: carrier });
        continue;
      }
    }
    out.push({ ...r, carrier_status: carrier });
  }
  return out;
}

// ── Sweep ────────────────────────────────────────────────────────────────

const SWEEP_EVERY_MS = 30 * 60 * 1000;
const FIRST_RUN_AFTER_MS = 3 * 60 * 1000;
const LOOKBACK_DAYS = 120;
/** ITD calls in flight at once during a sweep. */
const SWEEP_BATCH = 5;

let sweeping = false;

/**
 * Every open order with a real AWB: ask ITD, and move to `dispatched` the ones
 * ITD already has. For the orders no customer or ops screen is looking at.
 */
export async function sweepCarrierSync(): Promise<{ checked: number; moved: number } | null> {
  if (sweeping) return null;
  sweeping = true;
  try {
    const client = dbClient("carrierStatus");
    if (!client) return null;
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const { data, error } = await client
      .from("orders")
      .select("id, status, awb_no")
      .not("awb_no", "is", null)
      .not("status", "in", "(dispatched,cancelled)")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) {
      logDbError("carrierStatus", "sweep", error);
      return null;
    }
    const rows = ((data ?? []) as { id: string; status: string; awb_no: string }[]).filter(
      (r) => !isTestAwb(r.awb_no)
    );

    let checked = 0;
    let moved = 0;
    for (let i = 0; i < rows.length; i += SWEEP_BATCH) {
      const batch = rows.slice(i, i + SWEEP_BATCH);
      const statuses = await carrierStatusesFor(
        batch.map((r) => r.awb_no),
        { maxRefresh: SWEEP_BATCH, waitMs: 30_000 }
      );
      for (const r of batch) {
        checked++;
        const carrier = statuses.get(r.awb_no.trim());
        if (shouldAutoDispatch(r.status, carrier) && (await syncOrderWithCarrier(r.awb_no, carrier))) {
          moved++;
        }
      }
    }
    console.log("[carrierStatus] sweep", { open: rows.length, checked, moved });
    return { checked, moved };
  } finally {
    sweeping = false;
  }
}

let timer: NodeJS.Timeout | null = null;

/** Production only, like the other schedules: local servers share the database. */
export function startCarrierSyncTimer(): void {
  if (timer) return;
  const run = () =>
    void sweepCarrierSync().catch((err) => console.error("[carrierStatus] sweep threw:", err));
  setTimeout(run, FIRST_RUN_AFTER_MS).unref?.();
  timer = setInterval(run, SWEEP_EVERY_MS);
  timer.unref?.();
}
