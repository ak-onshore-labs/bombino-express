import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

// No database, as before the cases migration has run. The shell may carry the
// Supabase credentials, so they're cleared before the client is created.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const { registerOpsCaseRoutes } = await import("./opsCases.js");

const CASE_ID = "00000000-0000-4000-8000-000000000001";
let server: Server;
let base = "";

before(async () => {
  const app = express();
  app.use(express.json());
  // Stand-in for express-session: the test says who is asking in a header.
  app.use((req, _res, next) => {
    const role = req.header("x-test-role");
    (req as unknown as { session: Record<string, unknown> }).session = role
      ? { user: { id: "u1", role }, dbUserId: "11111111-1111-4111-8111-111111111111" }
      : {};
    next();
  });
  registerOpsCaseRoutes(app);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

async function call(path: string, role: string | null, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (role) headers["x-test-role"] = role;
  const res = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

test("signed out gets 401, a customer or a rider gets 403, on every case route", async () => {
  const routes: [string, unknown][] = [
    ["/api/ops/cases", undefined],
    [`/api/ops/cases/${CASE_ID}`, undefined],
    [`/api/ops/cases/${CASE_ID}/reply`, { reply: "Hello" }],
    [`/api/ops/cases/${CASE_ID}/close`, {}],
  ];
  for (const [path, body] of routes) {
    assert.equal((await call(path, null, body)).status, 401, path);
    for (const role of ["customer", "rider"]) {
      const res = await call(path, role, body);
      assert.equal(res.status, 403, `${role} ${path}`);
      assert.equal(res.json.code, "FORBIDDEN");
    }
  }
});

test("the queue says cases aren't set up while the table is missing", async () => {
  for (const role of ["admin", "super_admin"]) {
    const res = await call("/api/ops/cases?status=open", role);
    assert.equal(res.status, 503);
    assert.equal(res.json.code, "CASES_NOT_SET_UP");
  }
  assert.equal((await call(`/api/ops/cases/${CASE_ID}`, "admin")).json.code, "CASES_NOT_SET_UP");
});

test("an unknown status filter is refused", async () => {
  assert.equal((await call("/api/ops/cases?status=pending", "admin")).status, 400);
});

test("a case id that isn't a uuid is not found, without asking the database", async () => {
  assert.equal((await call("/api/ops/cases/BIA-1001", "admin")).status, 404);
  assert.equal((await call("/api/ops/cases/BIA-1001/reply", "admin", { reply: "Hi" })).status, 404);
  assert.equal((await call("/api/ops/cases/BIA-1001/close", "admin", {})).status, 404);
});

test("a reply must be written, and no longer than 2000 characters", async () => {
  const path = `/api/ops/cases/${CASE_ID}/reply`;
  assert.equal((await call(path, "admin", {})).status, 400);
  assert.equal((await call(path, "admin", { reply: "   " })).status, 400);
  assert.equal((await call(path, "admin", { reply: "x".repeat(2001) })).status, 400);
  // A fair reply gets past validation and fails soft on the missing table.
  assert.equal((await call(path, "admin", { reply: "We've raised it with the courier." })).status, 503);
});
