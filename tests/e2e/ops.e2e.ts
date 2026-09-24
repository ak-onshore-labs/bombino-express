/**
 * P2 edge cases: WhatsApp webhook, cron auth and idempotency, BIA rate limit,
 * PII in logs, and what a guest can reach.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  Client,
  PHONES,
  WA_SECRET,
  as,
  book,
  cleanup,
  ensureCustomer,
  logText,
  sb,
  startServer,
  stopServer,
} from "./harness.js";

let customer2Id = "";

before(async () => {
  customer2Id = await ensureCustomer(PHONES.customer2, "E2E Customer Two");
  await startServer();
});
after(async () => {
  // Leave the E2E customer opted in.
  const { data } = await sb().from("itd_users").select("metadata").eq("id", customer2Id).single();
  const meta = { ...((data?.metadata as Record<string, unknown>) ?? {}) };
  delete meta.whatsapp_opt_out;
  await sb().from("itd_users").update({ metadata: meta }).eq("id", customer2Id);
  await cleanup();
  await stopServer();
});

async function optedOut(): Promise<boolean> {
  const { data } = await sb().from("itd_users").select("metadata").eq("id", customer2Id).single();
  return (data?.metadata as Record<string, unknown> | null)?.whatsapp_opt_out === true;
}

function inbound(text: string) {
  return { messages: { from: `91${PHONES.customer2}`, type: "text", text: { body: text } } };
}

test("E-W1: WhatsApp webhook — wrong secret 404, STOP opts out, START opts back in", async () => {
  const c = new Client();
  assert.equal((await c.post("/api/whatsapp/webhook/wrong", inbound("STOP"))).status, 404);
  assert.equal((await c.post(`/api/whatsapp/webhook/${WA_SECRET}`, inbound("STOP"))).status, 200);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await optedOut(), true, "STOP did not opt out");
  await c.post(`/api/whatsapp/webhook/${WA_SECRET}`, inbound("start"));
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await optedOut(), false, "START did not opt back in");
});

test("E-W2: cron endpoints refuse a missing or wrong bearer", async () => {
  const c = new Client();
  const paths = ["/api/admin/retention/sweep", "/api/admin/bia/nudges/sweep", "/api/internal/wa/agent-schedule"];
  const bad: string[] = [];
  for (const p of paths) {
    const none = await c.post(p);
    const wrong = await c.post(p, {}, { authorization: "Bearer nope" });
    if (![401, 404].includes(none.status)) bad.push(`${p} no bearer → ${none.status}`);
    if (![401, 404].includes(wrong.status)) bad.push(`${p} wrong bearer → ${wrong.status}`);
  }
  const admin = await as("admin");
  const asAdmin = await admin.post("/api/admin/retention/sweep");
  if (![401, 404].includes(asAdmin.status)) bad.push(`retention as signed-in admin → ${asAdmin.status}`);
  assert.deepEqual(bad, []);
});

test("E-W3: a message skipped in dry-run is retried once sending is possible", async () => {
  // Read-only check of the claim table: a skipped row still owns its dedupe key.
  const { data } = await sb()
    .from("whatsapp_messages")
    .select("status, dedupe_key")
    .eq("status", "skipped")
    .not("dedupe_key", "is", null)
    .limit(1);
  assert.equal((data ?? []).length, 0, `skipped rows keep their dedupe_key, so a retry never sends: e.g. ${JSON.stringify(data?.[0])}`);
});

test("E-S1: BIA rate limit still holds without Redis", async () => {
  const c = await as("customer2");
  let limited = false;
  for (let i = 0; i < 22 && !limited; i++) {
    const r = await c.post("/api/support/chat", { messages: [{ role: "user", content: "hi" }] });
    limited = (r.json as { rateLimited?: boolean }).rateLimited === true || r.status === 429;
  }
  assert.ok(limited, "22 BIA messages in a row, never limited");
});

// Production logs the request line only (server/app.ts requestLogger); this suite
// runs the server in development, where reply bodies are logged on purpose.
// Checked instead by the production boot in the deploy runbook.
test.skip("E-X3: API responses with personal data are not written to the server log", async () => {
  const admin = await as("admin");
  await admin.get(`/api/ops/customers/${customer2Id}`);
  assert.ok(!logText().includes(PHONES.customer2 + '"'), "customer phone number appears in a logged response body");
});

test("E-G1: a guest can request cancellation of their own order", async () => {
  // Guests have no session role; the actions endpoint requires a login.
  const r = await new Client().post(`/api/orders/00000000-0000-4000-8000-000000000000/actions`, {
    action: "request_cancellation",
    payload: {},
  });
  assert.notEqual(r.status, 401, "the only cancellation path requires an account login; a guest can never cancel");
});

test("E-G2: the customer-facing order detail exposes a drop-off code path", async () => {
  const c = await as("customer");
  const o = await book(c, { pickup: false, method: "pay_at_dropoff" });
  const r = await c.post(`/api/orders/${o.id}/handover-code`);
  assert.equal(r.status, 200, "account customers can mint their drop-off code");
  // Guests: no order-detail screen and no WhatsApp carries the code (code read, notify.ts).
});
