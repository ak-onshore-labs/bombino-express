/**
 * End-to-end harness: boots the real server on 127.0.0.1:5001 against the
 * shared Supabase project, signs in as real test accounts, and books real
 * orders that are tagged and deleted afterwards.
 *
 * Safety: the server is forced into a mode that cannot reach anyone outside
 * this machine — WhatsApp is dry-run, no ITD docket is filed at booking, and
 * pay-now settles through the test switch. See docs/final-phase/markdowns/test-report.md.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";

export const PORT = 5001;
export const BASE = `http://127.0.0.1:${PORT}`;
export const OTP = "246810";
export const WEBHOOK_SECRET = "e2e-webhook-secret";
export const CRON_SECRET = "e2e-cron";
export const WA_SECRET = "e2e-wa-secret";
export const RUN_ID = randomUUID().slice(0, 8);
export const TAG = `E2E-${RUN_ID}`;

/** Test identities — see docs/test-accounts.md. */
export const PHONES = {
  admin: "9000000010",
  agentA: "9000000014",
  agentB: "9000000012",
  customer: "9000000090",
  customer2: "9000000095",
  guest: "9000000096",
  otpVictim: "9000000097",
  otpSpare: "9000000098",
} as const;

export const SERVER_ENV: Record<string, string> = {
  PORT: String(PORT),
  NODE_ENV: "development",
  WA_DRY_RUN: "1",
  ITD_DOCKET_AT_BOOKING: "0",
  OTP_FIXED_CODE: OTP,
  OTP_DEV_BYPASS: "0",
  PAYMENTS_TEST_MODE: "1",
  RAZORPAY_KEY_ID: "rzp_test_e2e",
  RAZORPAY_KEY_SECRET: "e2e-key-secret",
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
  WA_CRON_SECRET: CRON_SECRET,
  TATA_WA_WEBHOOK_SECRET: WA_SECRET,
  TATA_WA_TOKEN: "",
  PUBLIC_URL: BASE,
};

let sbClient: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!sbClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env");
    sbClient = createClient(url, key);
  }
  return sbClient;
}

// ── server ──────────────────────────────────────────────────────────────────

let child: ChildProcess | null = null;
export const serverLog: string[] = [];

export async function startServer(extraEnv: Record<string, string> = {}): Promise<void> {
  if (child) return;
  child = spawn(process.execPath, ["--import", "./server/dns-ipv4first.mjs", "--import", "tsx", "server/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, ...SERVER_ENV, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (buf: Buffer) => serverLog.push(buf.toString());
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/auth/me`);
      if (res.status > 0) return;
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null) throw new Error(`server exited early:\n${serverLog.join("")}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start on ${PORT}:\n${serverLog.join("").slice(-3000)}`);
}

export async function stopServer(): Promise<void> {
  if (!child) return;
  if (process.env.E2E_LOG) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.E2E_LOG, logText());
  }
  const proc = child;
  child = null;
  await new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    proc.kill();
    setTimeout(resolve, 5000);
  });
}

export function logText(): string {
  return serverLog.join("");
}

// ── http client with a cookie jar ───────────────────────────────────────────

export interface Reply<T = Record<string, unknown>> {
  status: number;
  json: T;
  text: string;
  headers: Headers;
}

export class Client {
  cookies = new Map<string, string>();
  constructor(readonly label = "anon") {}

  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  sessionId(): string | undefined {
    return this.cookies.get("connect.sid");
  }

  async call<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ): Promise<Reply<T>> {
    const h: Record<string, string> = { ...headers };
    if (body !== undefined && !(body instanceof FormData) && !h["content-type"]) h["content-type"] = "application/json";
    const cookie = this.cookieHeader();
    if (cookie) h.cookie = cookie;
    const res = await fetch(BASE + path, {
      method,
      headers: h,
      body:
        body === undefined ? undefined : body instanceof FormData || typeof body === "string" ? body : JSON.stringify(body),
      redirect: "manual",
    });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(";");
      const idx = pair.indexOf("=");
      this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { _raw: text.slice(0, 300) };
    }
    return { status: res.status, json: json as T, text, headers: res.headers };
  }

  get<T = Record<string, unknown>>(path: string) {
    return this.call<T>("GET", path);
  }
  post<T = Record<string, unknown>>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.call<T>("POST", path, body ?? {}, headers);
  }
}

/** Clears this run's rate-limit history for a phone so logins don't hit 429. */
export async function resetOtpHistory(phone: string): Promise<void> {
  await sb().from("otp_codes").delete().eq("phone", phone);
}

export async function signIn(phone: string, label = phone): Promise<Client> {
  await resetOtpHistory(phone);
  const c = new Client(label);
  const req = await c.post("/api/auth/otp/request", { phone, purpose: "auth" });
  if (req.status !== 200) throw new Error(`otp/request ${phone}: ${req.status} ${req.text}`);
  const cont = await c.post("/api/auth/phone/continue", { phone, code: OTP });
  if (cont.status !== 200) throw new Error(`phone/continue ${phone}: ${cont.status} ${cont.text}`);
  return c;
}

const clientCache = new Map<string, Promise<Client>>();
/** One signed-in client per role for the whole file — logins are rate limited. */
export function as(role: keyof typeof PHONES): Promise<Client> {
  if (!clientCache.has(role)) clientCache.set(role, signIn(PHONES[role], role));
  return clientCache.get(role)!;
}

// ── accounts ────────────────────────────────────────────────────────────────

/** A second phone-only customer, so ownership can be tested across accounts. */
export async function ensureCustomer(phone: string, fullName: string): Promise<string> {
  const { data } = await sb().from("itd_users").select("id, role").eq("phone", phone).maybeSingle();
  if (data) return data.id as string;
  const synthetic = `local-${randomUUID()}`;
  const { data: created, error } = await sb()
    .from("itd_users")
    .insert({
      itd_customer_id: synthetic,
      itd_customer_code: synthetic,
      full_name: fullName,
      email: "",
      username: phone,
      phone,
      role: "customer",
      is_active: true,
      metadata: { seeded_by: "tests/e2e/harness.ts", seeded_at: new Date().toISOString() },
    })
    .select("id")
    .single();
  if (error) throw new Error(`ensureCustomer ${phone}: ${error.message}`);
  return created!.id as string;
}

export async function userIdByPhone(phone: string): Promise<string> {
  const { data } = await sb().from("itd_users").select("id").eq("phone", phone).single();
  return data!.id as string;
}

// ── orders ──────────────────────────────────────────────────────────────────

export type PaymentMethod = "pay_now" | "pay_at_pickup" | "pay_at_dropoff" | "cod";

export function istDate(offsetDays = 0): string {
  const now = new Date(Date.now() + 5.5 * 3600_000 + offsetDays * 86400_000);
  return now.toISOString().slice(0, 10);
}

export function bookingBody(opts: {
  pickup?: boolean;
  method?: PaymentMethod;
  weight?: number;
  amount?: number;
  pincode?: string;
  date?: string | null;
  phone?: string;
}): Record<string, unknown> {
  const pickup = opts.pickup ?? true;
  return {
    pickup_request: pickup ? 1 : 2,
    pickup_date: pickup ? (opts.date === undefined ? istDate(3) : opts.date) : null,
    payment_method: opts.method ?? (pickup ? "pay_at_pickup" : "pay_at_dropoff"),
    booked_weight: opts.weight ?? 2,
    quoted_amount: opts.amount ?? 2000,
    origin_address: {
      full_name: TAG,
      phone: opts.phone ?? PHONES.customer,
      address_line_1: "1 Test Street",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: opts.pincode ?? "400001",
      country_code: "IN",
      country_name: "India",
    },
    consignee: {
      name: TAG,
      address: "1 Main St",
      city: "New York",
      state: "NY",
      zipcode: "10001",
      country_code: "US",
      phone: "2125550100",
    },
    items: {
      description: "Cotton shirts",
      hsn_code: "62052000",
      quantity: 2,
      value: 1000,
      length: 20,
      width: 15,
      height: 10,
      weight: opts.weight ?? 2,
    },
  };
}

export interface OrderRow {
  id: string;
  order_no: string;
  status: string;
  payment_status: string | null;
  payment_method: string;
  agent_id: string | null;
  actual_weight: string | number | null;
  final_amount: string | number | null;
  quoted_amount: string | number | null;
  awb_no: string | null;
  metadata: Record<string, unknown> | null;
}

export async function book(client: Client, opts: Parameters<typeof bookingBody>[0] = {}): Promise<OrderRow> {
  const res = await client.post<{ order: OrderRow }>("/api/orders", bookingBody(opts));
  if (res.status !== 200) throw new Error(`book: ${res.status} ${res.text}`);
  return res.json.order;
}

export async function reload(orderId: string): Promise<OrderRow> {
  const { data, error } = await sb().from("orders").select("*").eq("id", orderId).single();
  if (error) throw new Error(`reload ${orderId}: ${error.message}`);
  return data as OrderRow;
}

export function act(client: Client, orderId: string, action: string, payload?: Record<string, unknown>) {
  return client.post<Record<string, unknown>>(`/api/orders/${orderId}/actions`, payload ? { action, payload } : { action });
}

export async function mustAct(client: Client, orderId: string, action: string, payload?: Record<string, unknown>) {
  const r = await act(client, orderId, action, payload);
  if (r.status !== 200) throw new Error(`${action} as ${client.label}: ${r.status} ${r.text}`);
  return r;
}

/** Mints a fresh handover code as whoever shows it. */
export async function codeFor(client: Client, orderId: string): Promise<string> {
  const r = await client.post<{ handover?: { code: string } }>(`/api/orders/${orderId}/handover-code`);
  if (r.status !== 200 || !r.json.handover?.code) throw new Error(`handover-code: ${r.status} ${r.text}`);
  return r.json.handover.code;
}

/** Test fixture shortcut: the pickup date gate is tested on its own. */
export async function makePickupToday(orderId: string): Promise<void> {
  await sb().from("orders").update({ pickup_date: istDate(0) }).eq("id", orderId);
}

/**
 * Walks a pickup order through the real action endpoint to `target`.
 * Every step is the same call the apps make.
 */
export async function drivePickup(
  orderId: string,
  target: "agent_accepted" | "out_for_pickup" | "picked_up" | "received_at_hub" | "weighed" | "settled" | "dispatched",
  opts: { weight?: number } = {}
): Promise<OrderRow> {
  const [agent, admin, customer] = await Promise.all([as("agentA"), as("admin"), as("customer")]);
  const order = () => reload(orderId);
  const order0 = await order();
  const steps = ["agent_accepted", "out_for_pickup", "picked_up", "received_at_hub", "weighed", "settled", "dispatched"];
  const stop = steps.indexOf(target);
  if (order0.status === "pickup_requested") await mustAct(agent, orderId, "claim");
  if (stop === 0) return order();
  await makePickupToday(orderId);
  await mustAct(agent, orderId, "start_pickup");
  if (stop === 1) return order();
  let o = await order();
  if (o.payment_method === "pay_at_pickup" && o.payment_status !== "paid") {
    await mustAct(agent, orderId, "collect_payment", { amount: Number(o.quoted_amount), collection_mode: "cash" });
  }
  await mustAct(agent, orderId, "mark_picked_up", { otp: await codeFor(customer, orderId) });
  if (stop === 2) return order();
  await mustAct(agent, orderId, "mark_received_at_hub", { otp: await codeFor(admin, orderId) });
  if (stop === 3) return order();
  await mustAct(admin, orderId, "weigh", { actual_weight: opts.weight ?? 2 });
  if (stop === 4) return order();
  o = await order();
  await mustAct(admin, orderId, "settle");
  if (stop === 5) return order();
  await mustAct(admin, orderId, "generate_docket");
  return order();
}

// ── razorpay webhook ────────────────────────────────────────────────────────

export function signWebhook(raw: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
}

// ── cleanup ─────────────────────────────────────────────────────────────────

export async function cleanup(): Promise<void> {
  const db = sb();
  const { data: orders, error } = await db
    .from("orders")
    .select("id, order_no")
    .eq("consignee->>name", TAG);
  if (error) console.error("[e2e cleanup] listing orders failed:", error.message);
  const ids = (orders ?? []).map((o) => o.id as string);
  for (const o of orders ?? []) {
    // Notifications carry the order in `data`, not an order_id column.
    await db.from("notifications").delete().contains("data", { order_id: o.id });
  }
  if (ids.length) {
    await db.from("whatsapp_messages").delete().in("order_id", ids);
    const del = await db.from("orders").delete().in("id", ids);
    if (del.error) console.error("[e2e cleanup] deleting orders failed:", del.error.message);
  }
  await db.from("addresses").delete().eq("full_name", TAG);
}

/** Every E2E-tagged order from any run, for the leftovers check. */
export async function leftoverCount(): Promise<number> {
  const { count } = await sb().from("orders").select("id", { count: "exact", head: true }).like("consignee->>name", "E2E-%");
  return count ?? 0;
}
