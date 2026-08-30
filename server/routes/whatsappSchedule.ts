/**
 * The one agent message that needs a clock: the morning digest.
 *
 * There was a second — a nudge 45 minutes before a job's pickup window opened.
 * Pickups no longer carry a window, so there is no moment to count back from,
 * and the reminder went with it. DELETE THE `kind=reminders` CRON JOB: this
 * endpoint runs the digest whatever `kind` says, so a 15-minute schedule now
 * means 96 redundant digest runs a day. Deduped, so harmless — but pointless.
 *
 * Driven by an EXTERNAL SCHEDULER hitting this endpoint, not by a `setInterval`
 * in the process. Two reasons, and both have bitten this deployment shape
 * before: the Railway service restarts on every push, which kills a timer
 * silently and leaves no trace of the messages that stopped going out; and a
 * second instance would fire everything twice. The dedupe key makes the second
 * harmless rather than merely unlikely, but an explicit trigger is observable
 * from outside and a timer is not.
 *
 * Wire it as one Railway cron job against
 *   POST {PUBLIC_URL}/api/internal/wa/agent-schedule
 * with `Authorization: Bearer {WA_CRON_SECRET}`, once early —
 * 07:00 IST is 01:30 UTC.
 *
 * Running it more often is safe. Every message is deduped, so a digest fired
 * hourly still sends exactly one per agent per day.
 */

import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { supabase } from "../supabaseClient.js";
import { toOrder, type OrderRow } from "../ordersDb.js";
import type { Order } from "../../shared/orderContract.js";
import { todayInIst } from "../../shared/istTime.js";
import { listAllAgents } from "../whatsappAgents.js";
import { deliverToAgent } from "../notify.js";
import { agentDailyDigestMessage } from "../whatsappTemplates.js";

// No address join: the digest counts an agent's jobs and names none of them.
// The per-job reminder that needed a pickup area went with the pickup window.
const JOB_COLUMNS =
  "id, order_no, user_id, status, pickup_request, pickup_date, origin_address_id, " +
  "consignee, items, booked_weight, quoted_amount, payment_method, payment_status, is_cod, " +
  "agent_id, actual_weight, final_amount, awb_no, metadata, created_at, updated_at";

function authorised(req: Request): boolean {
  const expected = process.env.WA_CRON_SECRET;
  if (!expected) return false;

  const header = req.header("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (presented.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}

/**
 * Every claimed, not-yet-started job for a date.
 *
 * `agent_accepted` only. A job already at `out_for_pickup` has an agent on the
 * road for it, and counting the thing someone is currently doing into a
 * morning digest is how a notification channel gets muted.
 */
async function listClaimedJobsForDate(
  date: string
): Promise<(Order & { agentId: string })[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("orders")
    .select(JOB_COLUMNS)
    .eq("pickup_date", date)
    .eq("status", "agent_accepted")
    .not("agent_id", "is", null);

  if (error) {
    console.error("[whatsappSchedule] could not read claimed jobs (non-fatal):", {
      message: error.message,
      code: error.code,
    });
    return [];
  }

  return (data as unknown as OrderRow[]).map((row) => ({
    ...toOrder(row),
    agentId: row.agent_id as string,
  }));
}

/**
 * One message per agent who has work today, and how much of it.
 *
 * Agents with nothing on are not messaged. A digest that says "0 jobs" is a
 * notification that exists only to be dismissed.
 */
async function sendDailyDigest(date: string): Promise<number> {
  const jobs = await listClaimedJobsForDate(date);
  if (jobs.length === 0) return 0;

  const byAgent = new Map<string, typeof jobs>();
  for (const job of jobs) {
    byAgent.set(job.agentId, [...(byAgent.get(job.agentId) ?? []), job]);
  }

  const agents = await listAllAgents();
  let sent = 0;

  for (const agent of agents) {
    const theirs = byAgent.get(agent.id);
    if (!theirs || theirs.length === 0) continue;

    await deliverToAgent({
      message: agentDailyDigestMessage({
        agentName: agent.full_name,
        jobCount: theirs.length,
        date,
      }),
      agentId: agent.id,
      agentPhone: agent.phone,
      // A digest spans several orders, so it belongs to none of them.
      orderId: null,
      scope: `digest:${agent.id}`,
    });
    sent++;
  }

  return sent;
}

export function registerWhatsappScheduleRoutes(app: Express): void {
  app.post("/api/internal/wa/agent-schedule", async (req: Request, res: Response) => {
    if (!authorised(req)) {
      // 404, not 401. An internal endpoint that confirms it exists is an
      // internal endpoint somebody will start guessing at.
      res.status(404).json({ message: "Not found" });
      return;
    }

    // `kind` is ignored: the digest is the only run left. A still-configured
    // `kind=reminders` cron therefore fires a duplicate digest rather than a
    // 400, which the dedupe key absorbs.
    const date = todayInIst();

    try {
      const sent = await sendDailyDigest(date);
      res.json({ ok: true, kind: "digest", date, sent });
    } catch (error) {
      console.error("[whatsappSchedule] run failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      // 500 so a scheduler with retries tries again. Every message is deduped,
      // so a retry after a partial run finishes the job rather than repeating it.
      res.status(500).json({ ok: false, kind: "digest" });
    }
  });
}
