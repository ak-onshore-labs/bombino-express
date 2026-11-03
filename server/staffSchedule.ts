/**
 * WhatsApp on a clock — the agents' morning list, and the team's reminders and
 * daily summary. Times are IST and are the ones proposed to the team (team
 * review, question 5):
 *
 *   08:00  agents       today's pickups, one message each, only if they have any
 *   09:00  branches     today's pickups that still have no agent
 *   09:00  everyone     yesterday's summary (branch: its city; admins: all)
 *   18:00  branches     tomorrow's pickups that still have no agent
 *   20:00  branches     pickups due in the last three days, still not collected
 *
 * Two ways in, and either is enough:
 *
 *   - an in-process timer (`startScheduleTimer`), every five minutes, in
 *     production only. Local servers share the production database, so a
 *     development server must never message real staff off a clock;
 *   - POST /api/internal/wa/agent-schedule, for an external scheduler.
 *
 * Each job runs at any tick inside its window, not only at the exact minute, so
 * a restart at 09:02 still sends the 09:00 summary. What stops it going twice
 * — across ticks, restarts and a second instance — is the dedupe key on every
 * message (one per person per day), not the clock. The window closes a few
 * hours later so a server that was down all morning does not send "good
 * morning" at night.
 */

import type { Order, OrderStatus } from "../shared/orderContract.js";
import { hasOpenCancellationRequest } from "../shared/orderContract.js";
import { nowInIst, startOfIstDayIso } from "../shared/istTime.js";
import { isTestOrderMetadata } from "../shared/testOrders.js";
import { dbClient, logDbError } from "./db/client.js";
import { deliverToAgent } from "./notify.js";
import {
  notifyStaffDailySummary,
  notifyStaffOfOverduePickup,
  notifyStaffOfUnassignedPickups,
} from "./notifyStaff.js";
import { getUserContactsByIds, toOrder, type OrderRow } from "./ordersDb.js";
import { citiesOfOrders } from "./staffScope.js";
import { listAllAgents } from "./whatsappAgents.js";
import {
  agentDailyDigestMessage,
  agentMorningJobsMessage,
  NEW_TEMPLATES_LIVE,
  type DailySummary,
} from "./whatsappTemplates.js";

const getSupabaseClient = () => dbClient("staffSchedule");

const ORDER_COLUMNS =
  "id, order_no, user_id, guest_ref, guest_name, guest_email, guest_phone, status, pickup_request, pickup_date, origin_address_id, consignee, items, booked_weight, quoted_amount, packaging_required, payment_method, payment_status, is_cod, agent_id, actual_weight, final_amount, awb_no, metadata, created_at, updated_at";

/** Not yet with the courier and not cancelled: what the team still owes work on. */
const ACTIVE: OrderStatus[] = [
  "pickup_requested",
  "agent_accepted",
  "out_for_pickup",
  "picked_up",
  "awaiting_dropoff",
  "received_at_hub",
  "weighed",
  "settled",
  "ready_for_docket",
];
const AT_HUB: OrderStatus[] = ["received_at_hub", "weighed", "settled", "ready_for_docket"];
const NOT_COLLECTED: OrderStatus[] = ["pickup_requested", "agent_accepted", "out_for_pickup"];

/** `2026-10-26` + 1 → `2026-10-27`. Calendar arithmetic on the bare date. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type OrdersQuery = ReturnType<ReturnType<NonNullable<ReturnType<typeof getSupabaseClient>>["from"]>["select"]>;

/** Orders matching `filter`, or null on a DB miss (the job is then retried next tick). */
async function loadOrders(operation: string, filter: (query: OrdersQuery) => OrdersQuery): Promise<Order[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await filter(client.from("orders").select(ORDER_COLUMNS));
  if (error) {
    logDbError("staffSchedule", operation, error);
    return null;
  }
  return ((data ?? []) as OrderRow[]).map((row) => toOrder(row));
}

async function loadOrdersByIds(ids: string[]): Promise<Order[] | null> {
  const out: Order[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = await loadOrders("loadOrdersByIds", (q) => q.in("id", chunk));
    if (!rows) return null;
    out.push(...rows);
  }
  return out;
}

const isTest = (order: Order) => isTestOrderMetadata(order.metadata);

// ── Jobs ──────────────────────────────────────────────────────────────────

/** Each agent with claimed pickups today, and how many. */
async function agentMorningJobs(today: string): Promise<number | null> {
  const jobs = await loadOrders("agentMorningJobs", (q) =>
    q.eq("pickup_date", today).eq("status", "agent_accepted").not("agent_id", "is", null)
  );
  if (!jobs) return null;

  const counts = new Map<string, number>();
  for (const job of jobs) counts.set(job.agent_id!, (counts.get(job.agent_id!) ?? 0) + 1);
  if (counts.size === 0) return 0;

  let sent = 0;
  for (const agent of await listAllAgents()) {
    const count = counts.get(agent.id);
    if (!count) continue;
    await deliverToAgent({
      message: (NEW_TEMPLATES_LIVE ? agentMorningJobsMessage : agentDailyDigestMessage)({
        agentName: agent.full_name,
        jobCount: count,
        date: today,
      }),
      agentId: agent.id,
      agentPhone: agent.phone,
      // Several orders, so none of them.
      orderId: null,
      scope: `morning:${agent.id}`,
    });
    sent++;
  }
  return sent;
}

/** Pickups on `date` with no agent, one reminder per city and side. */
async function unassignedPickups(date: string, slot: string): Promise<number | null> {
  const orders = await loadOrders("unassignedPickups", (q) =>
    q.eq("pickup_date", date).eq("status", "pickup_requested").eq("pickup_request", 1).is("agent_id", null)
  );
  if (!orders) return null;
  if (orders.length === 0) return 0;

  const cities = await citiesOfOrders(orders.map((o) => o.id));
  if (!cities) return null;

  const groups = new Map<string, { city: string | null; test: boolean; count: number }>();
  for (const order of orders) {
    const city = cities.get(order.id) ?? null;
    const key = `${city ?? ""}|${isTest(order)}`;
    const group = groups.get(key) ?? { city, test: isTest(order), count: 0 };
    group.count++;
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    await notifyStaffOfUnassignedPickups({ ...group, date, slot });
  }
  return groups.size;
}

/**
 * Pickups due in the last three days and still not collected. Three, so a
 * stuck pickup is raised on a few evenings and then left to the daily
 * summary, rather than a months-old booking being raised every night forever.
 */
async function overduePickups(today: string): Promise<number | null> {
  const orders = await loadOrders("overduePickups", (q) =>
    q
      .gte("pickup_date", addDays(today, -2))
      .lte("pickup_date", today)
      .eq("pickup_request", 1)
      .in("status", NOT_COLLECTED)
  );
  if (!orders) return null;
  if (orders.length === 0) return 0;

  const cities = await citiesOfOrders(orders.map((o) => o.id));
  if (!cities) return null;
  const agents = await getUserContactsByIds(orders.map((o) => o.agent_id).filter((id): id is string => !!id));

  for (const order of orders) {
    await notifyStaffOfOverduePickup({
      order,
      city: cities.get(order.id) ?? null,
      agentName: order.agent_id ? agents.get(order.agent_id)?.full_name ?? null : null,
      runDate: today,
    });
  }
  return orders.length;
}

interface Tally {
  newBookings: number;
  collected: number;
  atHub: number;
  dispatched: number;
  unassigned: number;
  awbFailed: number;
  cancelRequests: number;
  refunds: number;
}

const emptyTally = (): Tally => ({
  newBookings: 0,
  collected: 0,
  atHub: 0,
  dispatched: 0,
  unassigned: 0,
  awbFailed: 0,
  cancelRequests: 0,
  refunds: 0,
});

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function toSummary(t: Tally): DailySummary {
  const attention: string[] = [];
  if (t.unassigned) attention.push(plural(t.unassigned, "pickup with no agent", "pickups with no agent"));
  if (t.awbFailed) attention.push(plural(t.awbFailed, "AWB failed", "AWBs failed"));
  if (t.cancelRequests) attention.push(plural(t.cancelRequests, "cancellation request", "cancellation requests"));
  if (t.refunds) attention.push(plural(t.refunds, "refund due", "refunds due"));
  return { ...t, attention };
}

/** A docket failure a person has to act on: not one the retry sweep still owns. */
function awbNeedsPerson(order: Order): boolean {
  if (order.awb_no) return false;
  const err = order.metadata?.docket_error;
  if (!err || typeof err !== "object") return false;
  return (err as Record<string, unknown>).retry !== "auto";
}

/** Yesterday's numbers, and what is waiting on someone this morning. */
async function dailySummary(today: string): Promise<number | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const day = addDays(today, -1);
  const from = startOfIstDayIso(day);
  const until = startOfIstDayIso(today);

  const [booked, active, refunds, events] = await Promise.all([
    loadOrders("summary bookings", (q) => q.gte("created_at", from).lt("created_at", until)),
    loadOrders("summary active", (q) => q.in("status", ACTIVE)),
    loadOrders("summary refunds", (q) => q.eq("payment_status", "refund_due")),
    client
      .from("order_events")
      .select("order_id, status")
      .in("status", ["picked_up", "dispatched"])
      .gte("created_at", from)
      .lt("created_at", until),
  ]);
  if (!booked || !active || !refunds || events.error) {
    if (events.error) logDbError("staffSchedule", "summary events", events.error);
    return null;
  }

  // One count per order per kind, whatever the event history holds.
  const collectedIds = new Set<string>();
  const dispatchedIds = new Set<string>();
  for (const row of (events.data ?? []) as { order_id: string; status: string }[]) {
    (row.status === "picked_up" ? collectedIds : dispatchedIds).add(row.order_id);
  }

  const known = new Map<string, Order>();
  for (const o of [...booked, ...active, ...refunds]) known.set(o.id, o);
  const missing = [...new Set([...collectedIds, ...dispatchedIds])].filter((id) => !known.has(id));
  const evented = await loadOrdersByIds(missing);
  if (!evented) return null;
  for (const o of evented) known.set(o.id, o);

  const cities = await citiesOfOrders([...known.keys()]);
  if (!cities) return null;

  // Two sides, kept apart like the boards: real staff never see test orders.
  const sides = new Map<boolean, { all: Tally; byCity: Map<string, Tally> }>([
    [false, { all: emptyTally(), byCity: new Map() }],
    [true, { all: emptyTally(), byCity: new Map() }],
  ]);
  const count = (order: Order, field: keyof Tally) => {
    const side = sides.get(isTest(order))!;
    side.all[field]++;
    const city = cities.get(order.id);
    if (!city) return;
    const tally = side.byCity.get(city) ?? emptyTally();
    tally[field]++;
    side.byCity.set(city, tally);
  };

  for (const o of booked) count(o, "newBookings");
  for (const id of collectedIds) count(known.get(id)!, "collected");
  for (const id of dispatchedIds) count(known.get(id)!, "dispatched");
  for (const o of refunds) count(o, "refunds");
  for (const o of active) {
    if (AT_HUB.includes(o.status)) count(o, "atHub");
    if (o.status === "pickup_requested" && o.pickup_request === 1 && !o.agent_id && (o.pickup_date ?? "") <= today) {
      count(o, "unassigned");
    }
    if (awbNeedsPerson(o)) count(o, "awbFailed");
    if (hasOpenCancellationRequest(o)) count(o, "cancelRequests");
  }

  for (const [test, side] of sides) {
    await notifyStaffDailySummary({
      date: day,
      test,
      all: toSummary(side.all),
      byCity: new Map([...side.byCity].map(([city, tally]) => [city, toSummary(tally)])),
      empty: toSummary(emptyTally()),
    });
  }
  return 1;
}

// ── The clock ─────────────────────────────────────────────────────────────

interface Job {
  name: string;
  /** IST hours: due from `from`:00 until `until`:00. */
  from: number;
  until: number;
  run: (today: string) => Promise<number | null>;
}

const JOBS: Job[] = [
  { name: "agent_morning_jobs", from: 8, until: 12, run: agentMorningJobs },
  { name: "unassigned_today", from: 9, until: 12, run: (today) => unassignedPickups(today, "morning") },
  { name: "daily_summary", from: 9, until: 13, run: dailySummary },
  { name: "unassigned_tomorrow", from: 18, until: 21, run: (today) => unassignedPickups(addDays(today, 1), "evening") },
  { name: "pickups_overdue", from: 20, until: 23, run: overduePickups },
];

/**
 * Jobs this process has finished today. Only saves the queries on later ticks;
 * correctness is the dedupe keys'. A job that hit a DB miss is not recorded,
 * so the next tick tries it again.
 */
const done = new Set<string>();

/** Run whatever is due now. Returns what each job did; null means it failed. */
export async function runDueSchedules(now: Date = new Date()): Promise<Record<string, number | null>> {
  const { date, hour } = nowInIst(now);
  const report: Record<string, number | null> = {};
  for (const job of JOBS) {
    const key = `${job.name}:${date}`;
    if (hour < job.from || hour >= job.until || done.has(key)) continue;
    try {
      const result = await job.run(date);
      report[job.name] = result;
      if (result !== null) done.add(key);
    } catch (error) {
      report[job.name] = null;
      console.error(`[staffSchedule] ${job.name} threw:`, error instanceof Error ? error.message : error);
    }
  }
  if (Object.keys(report).length > 0) console.log("[staffSchedule]", date, report);
  return report;
}

const TICK_MS = 5 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

export function startScheduleTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    void runDueSchedules().catch((err) => console.error("[staffSchedule] tick threw:", err));
  }, TICK_MS);
  timer.unref?.();
}

/** Production only: see the header. */
export function isScheduleTimerEnabled(): boolean {
  return process.env.NODE_ENV === "production";
}
