/**
 * The delivery check for reward points: every six hours, ask ITD how each
 * dispatched account order is doing, and land (or forfeit) its points once
 * the parcel is delivered (or returned, lost…).
 *
 * ITD does not tell us when a parcel is delivered; we have to ask per AWB.
 * Tracking reads elsewhere (a customer or ops opening tracking, the parcel
 * page) also land points the moment they see DELIVERED — this sweep is for
 * the parcels nobody looks at.
 *
 * Only orders that can still earn are asked about: account bookings (no
 * guest_ref) from EARN_FROM_BOOKING_DATE, dispatched in the last
 * LOOKBACK_DAYS, with an AWB, and no `earn` or `forfeit` row yet. At most
 * MAX_PER_SWEEP per run, one at a time, oldest first, so a backlog clears
 * over a few runs without hammering ITD.
 *
 * Production only, like the WhatsApp schedule: local servers share the
 * production database. Landing is idempotent (unique index), so a second
 * instance or an overlapping run cannot double-count.
 */

import { EARN_FROM_BOOKING_DATE } from "../shared/rewards.js";
import { isTestAwb } from "../shared/testOrders.js";
import { dbClient, logDbError } from "./db/client.js";
import { itdClient } from "./itd.js";
import { upsertTrackingEvents } from "./appDb.js";
import { rewardsOnTrackingState } from "./rewardsDb.js";

const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
/** First run shortly after boot, so a deploy does not wait six hours. */
const FIRST_RUN_AFTER_MS = 2 * 60 * 1000;
const LOOKBACK_DAYS = 120;
const MAX_PER_SWEEP = 150;
/** Pause between ITD calls. */
const GAP_MS = 400;

/** The latest scan's state from an ITD tracking answer, by event time. */
export function latestTrackingState(events: unknown[]): string | null {
  let best: { at: number; state: string } | null = null;
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const e = ev as Record<string, unknown>;
    const state = typeof e.event_state === "string" ? e.event_state.trim() : "";
    if (!state) continue;
    const at = typeof e.event_at === "string" ? new Date(e.event_at).getTime() : NaN;
    const t = Number.isFinite(at) ? at : -Infinity;
    if (!best || t >= best.at) best = { at: t, state };
  }
  return best?.state ?? null;
}

let running = false;

export async function sweepDeliveries(): Promise<{ checked: number; failed: number } | null> {
  if (running) return null;
  running = true;
  try {
    const client = dbClient("rewardsDelivery");
    if (!client) return null;

    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const earnFrom = new Date(`${EARN_FROM_BOOKING_DATE}T00:00:00+05:30`).toISOString();
    const { data: orders, error } = await client
      .from("orders")
      .select("id, awb_no, updated_at")
      .eq("status", "dispatched")
      .not("user_id", "is", null)
      .is("guest_ref", null)
      .not("awb_no", "is", null)
      .gte("created_at", earnFrom)
      .gte("updated_at", since)
      .order("updated_at", { ascending: true })
      .limit(1000);
    if (error) {
      logDbError("rewardsDelivery", "orders", error);
      return null;
    }

    const candidates = (orders ?? []).filter((o) => o.awb_no && !isTestAwb(o.awb_no as string));
    if (candidates.length === 0) return { checked: 0, failed: 0 };

    // Drop the ones already earned or forfeited.
    const closed = new Set<string>();
    for (let i = 0; i < candidates.length; i += 200) {
      const ids = candidates.slice(i, i + 200).map((o) => o.id as string);
      const { data, error: ledgerError } = await client
        .from("reward_ledger")
        .select("order_id")
        .in("order_id", ids)
        .in("kind", ["earn", "forfeit"]);
      if (ledgerError) {
        // Table missing (migration not run) or unreachable: nothing to do.
        if (ledgerError.code !== "42P01" && ledgerError.code !== "PGRST205") {
          logDbError("rewardsDelivery", "ledger", ledgerError);
        }
        return null;
      }
      for (const r of data ?? []) closed.add(r.order_id as string);
    }

    const todo = candidates.filter((o) => !closed.has(o.id as string)).slice(0, MAX_PER_SWEEP);
    let checked = 0;
    let failed = 0;
    for (const o of todo) {
      const awb = (o.awb_no as string).trim();
      try {
        const results = await itdClient.trackShipment(awb);
        const events = (results?.[0]?.docket_events ?? []) as unknown[];
        void upsertTrackingEvents(awb, events);
        await rewardsOnTrackingState(awb, latestTrackingState(events));
        checked++;
      } catch (err) {
        failed++;
        console.error("[rewardsDelivery] tracking failed", { awb, err: err instanceof Error ? err.message : err });
      }
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
    console.log("[rewardsDelivery] sweep", { candidates: candidates.length, checked, failed });
    return { checked, failed };
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;

export function startRewardsDeliveryTimer(): void {
  if (timer) return;
  const run = () => void sweepDeliveries().catch((err) => console.error("[rewardsDelivery] sweep threw:", err));
  setTimeout(run, FIRST_RUN_AFTER_MS).unref?.();
  timer = setInterval(run, SWEEP_EVERY_MS);
  timer.unref?.();
}
