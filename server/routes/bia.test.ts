import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

// No database, as before the nudges migration has run. The shell may carry the
// Supabase credentials, so they're cleared before the client is created.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.WA_CRON_SECRET = "test-secret-123";
const { registerBiaRoutes } = await import("./bia.js");
const { memoryNudgeStore, replaceNudgeStore } = await import("../supportNudges.js");

let server: Server;
let base = "";

before(async () => {
  const app = express();
  app.use(express.json());
  // Stand-in for express-session: the test says who is asking in headers.
  app.use((req, _res, next) => {
    const who = req.header("x-test-who");
    (req as unknown as { session: Record<string, unknown> }).session =
      who === "account"
        ? { user: { id: "c1", role: "customer" }, dbUserId: "11111111-1111-4111-8111-111111111111" }
        : who === "guest"
          ? { guestRef: "22222222-2222-4222-8222-222222222222", guestPhone: "9000000091" }
          : {};
    next();
  });
  registerBiaRoutes(app);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  replaceNudgeStore(null);
});

async function call(method: string, path: string, opts: { who?: string; auth?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.who) headers["x-test-who"] = opts.who;
  if (opts.auth) headers.authorization = opts.auth;
  const res = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

test("the sweep answers only to the scheduler's secret", async () => {
  assert.equal((await call("POST", "/api/admin/bia/nudges/sweep")).status, 401);
  assert.equal((await call("POST", "/api/admin/bia/nudges/sweep", { auth: "Bearer wrong-secret-12" })).status, 401);
  assert.equal((await call("POST", "/api/admin/bia/nudges/sweep", { who: "account" })).status, 401, "a signed-in customer is not the scheduler");
  // Right secret, no database: it fails without sending anything.
  const ok = await call("POST", "/api/admin/bia/nudges/sweep", { auth: "Bearer test-secret-123" });
  assert.equal(ok.status, 500);
});

test("switches: nobody signed in gets 401; before the migration they read as on and can't be saved", async () => {
  assert.equal((await call("GET", "/api/bia/nudges/prefs")).status, 401);
  const got = await call("GET", "/api/bia/nudges/prefs", { who: "account" });
  assert.equal(got.status, 200);
  assert.equal(got.json.available, false);
  const put = await call("PUT", "/api/bia/nudges/prefs", { who: "account", body: { kind: "pickup_tomorrow", on: false } });
  assert.equal(put.status, 503);
});

test("an account and a guest each see their own kinds, and switch them", async () => {
  replaceNudgeStore(memoryNudgeStore());
  const account = await call("GET", "/api/bia/nudges/prefs", { who: "account" });
  const kinds = (account.json.kinds as { kind: string; on: boolean }[]).map((k) => k.kind);
  assert.deepEqual(kinds, ["document_failed", "amount_changed", "pickup_tomorrow"]);
  const guest = await call("GET", "/api/bia/nudges/prefs", { who: "guest" });
  assert.ok((guest.json.kinds as { kind: string }[]).some((k) => k.kind === "guest_account"));

  // A guest-only kind isn't an account's to switch.
  assert.equal((await call("PUT", "/api/bia/nudges/prefs", { who: "account", body: { kind: "guest_account", on: false } })).status, 400);
  assert.equal((await call("PUT", "/api/bia/nudges/prefs", { who: "account", body: { kind: "pickup_tomorrow", on: "no" } })).status, 400);

  assert.equal((await call("PUT", "/api/bia/nudges/prefs", { who: "account", body: { kind: "pickup_tomorrow", on: false } })).status, 200);
  const after = await call("GET", "/api/bia/nudges/prefs", { who: "account" });
  const pickup = (after.json.kinds as { kind: string; on: boolean }[]).find((k) => k.kind === "pickup_tomorrow");
  assert.equal(pickup?.on, false);
  // The guest's switches are their own.
  const guestAfter = await call("GET", "/api/bia/nudges/prefs", { who: "guest" });
  assert.equal((guestAfter.json.kinds as { kind: string; on: boolean }[]).find((k) => k.kind === "pickup_tomorrow")?.on, true);
  replaceNudgeStore(null);
});
