/**
 * ITD's latest word on each order's parcel, for the screens that list orders.
 *
 * Our order status only moves when someone at Bombino presses a button. ITD
 * moves the parcel regardless: an order docketed at booking can be scanned,
 * flown and delivered while our row still says `received_at_hub` because ops
 * never weighed, settled or marked it dispatched (BOM-100347, Nov 2026). The
 * customer then sees "Arrived at Bombino hub" on Orders and "Delivered" when
 * they track the AWB. ITD is the truth about where the parcel is, so the
 * lists carry ITD's state and the client shows it once ITD has the parcel.
 *
 * Source: the `tracking_events` cache every tracking read fills. AWBs whose
 * cached answer is stale (or missing) and not final are asked again, a few at
 * a time; the request waits a short while for those answers and returns what
 * it has. A late answer still lands in the cache for the next read.
 *
 * Presentation only. This never moves the order's own status: the ops board,
 * payments and handover rules keep reading that.
 */

import { deliveryOutcome } from "../shared/rewards.js";
import { isTestAwb } from "../shared/testOrders.js";
import { dbClient, logDbError } from "./db/client.js";
import { itdClient } from "./itd.js";
import { upsertTrackingEvents } from "./appDb.js";
import { rewardsOnTrackingState } from "./rewardsDb.js";

/** ITD's latest scan for an AWB: its `event_state` and when it happened. */
export type CarrierStatus = { state: string; at: string };

/** Ask ITD again once our last answer for an AWB is this old. */
const REFRESH_AFTER_MS = 15 * 60 * 1000;
/** How long a list request waits for fresh ITD answers before replying. */
const WAIT_BUDGET_MS = 2500;
/** Most ITD calls one list request may start. The rest wait for the next read. */
const MAX_REFRESH_PER_CALL = 8;
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
  awbsIn: readonly (string | null | undefined)[]
): Promise<Map<string, CarrierStatus>> {
  const awbs = Array.from(
    new Set(awbsIn.map((a) => (a ?? "").trim()).filter((a) => a && !isTestAwb(a)))
  );
  const statuses = await readCached(awbs);

  const now = Date.now();
  const stale = awbs
    .filter((awb) => !isFinal(statuses.get(awb)?.state))
    .filter((awb) => now - (lastAsked.get(awb) ?? 0) > REFRESH_AFTER_MS)
    .slice(0, MAX_REFRESH_PER_CALL);
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
      timer = setTimeout(resolve, WAIT_BUDGET_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
  // Copied so answers arriving after the reply cannot change what was sent.
  return new Map(statuses);
}

/**
 * The same rows with `carrier_status` attached. Cancelled orders and orders
 * with no AWB get null.
 */
export async function withCarrierStatus<T extends { status: string; awb_no: string | null }>(
  rows: T[]
): Promise<(T & { carrier_status: CarrierStatus | null })[]> {
  const tracked = rows.filter((r) => r.awb_no && r.status !== "cancelled");
  const statuses = await carrierStatusesFor(tracked.map((r) => r.awb_no));
  return rows.map((r) => ({
    ...r,
    carrier_status:
      r.awb_no && r.status !== "cancelled" ? statuses.get(r.awb_no.trim()) ?? null : null,
  }));
}
