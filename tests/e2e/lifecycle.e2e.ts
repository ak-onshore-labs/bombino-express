/**
 * P0/P1 lifecycle edge cases: races, ownership, role boundaries, handover codes,
 * cancellations and booking validation.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  Client,
  PHONES,
  act,
  as,
  book,
  bookingBody,
  cleanup,
  codeFor,
  drivePickup,
  ensureCustomer,
  istDate,
  mustAct,
  reload,
  sb,
  startServer,
  stopServer,
} from "./harness.js";

before(async () => {
  await ensureCustomer(PHONES.customer2, "E2E Customer Two");
  await startServer();
});
after(async () => {
  await cleanup();
  await stopServer();
});

// ── races ───────────────────────────────────────────────────────────────────

test("E-L1: two agents claim the same pickup at once — exactly one wins, the other gets 409", async () => {
  const [c, a, b] = await Promise.all([as("customer"), as("agentA"), as("agentB")]);
  const o = await book(c, { method: "cod" });
  const [ra, rb] = await Promise.all([act(a, o.id, "claim"), act(b, o.id, "claim")]);
  const statuses = [ra.status, rb.status].sort();
  assert.deepEqual(statuses, [200, 409], `claim race → ${ra.status} ${ra.text} | ${rb.status} ${rb.text}`);
});

test("E-L2: generate_docket twice in parallel issues one AWB", async () => {
  const c = await as("customer");
  const admin = await as("admin");
  const o = await book(c, { method: "cod" });
  await drivePickup(o.id, "settled");
  const [x, y] = await Promise.all([act(admin, o.id, "generate_docket"), act(admin, o.id, "generate_docket")]);
  assert.equal([x, y].filter((r) => r.status === 200).length, 1, `docket race → ${x.status} / ${y.status}`);
});

test("E-L3: a settled order passes through ready_for_docket before dispatch", async () => {
  const c = await as("customer");
  const o = await book(c, { method: "cod" });
  await drivePickup(o.id, "dispatched");
  const { data } = await sb().from("order_events").select("status").eq("order_id", o.id);
  const seen = (data ?? []).map((e) => e.status as string);
  assert.ok(seen.includes("ready_for_docket"), `statuses seen: ${[...new Set(seen)].join(" → ")}`);
});

// ── agent boundaries ────────────────────────────────────────────────────────

test("E-L5: after received_at_hub the agent can do nothing and the job leaves their list", async () => {
  const c = await as("customer");
  const agent = await as("agentA");
  const o = await book(c, { method: "cod" });
  await drivePickup(o.id, "received_at_hub");
  for (const action of ["mark_received_at_hub", "mark_picked_up", "weigh", "settle"]) {
    assert.equal((await act(agent, o.id, action, {})).status, 403, `agent ${action} after hub`);
  }
  const mine = await agent.get("/api/agent/pickups/mine");
  assert.ok(!mine.text.includes(o.id), "job still on the agent's list");
});

test("E-L6: agent B cannot act on agent A's job", async () => {
  const [c, a, b] = await Promise.all([as("customer"), as("agentA"), as("agentB")]);
  const o = await book(c, { method: "cod" });
  await mustAct(a, o.id, "claim");
  await sb().from("orders").update({ pickup_date: istDate(0) }).eq("id", o.id);
  assert.equal((await act(b, o.id, "start_pickup")).status, 403);
  assert.equal((await act(b, o.id, "claim")).status, 403);
});

test("E-L8: cannot mark picked up while pay-at-pickup money is owed", async () => {
  const [c, agent] = await Promise.all([as("customer"), as("agentA")]);
  const o = await book(c, { method: "pay_at_pickup", amount: 300 });
  await drivePickup(o.id, "out_for_pickup");
  const code = await codeFor(c, o.id);
  assert.equal((await act(agent, o.id, "mark_picked_up", { otp: code })).status, 403);
});

test("E-L9: double-tapping a status action — the second is refused", async () => {
  const [c, agent] = await Promise.all([as("customer"), as("agentA")]);
  const o = await book(c, { method: "cod" });
  await mustAct(agent, o.id, "claim");
  await sb().from("orders").update({ pickup_date: istDate(0) }).eq("id", o.id);
  const [x, y] = await Promise.all([act(agent, o.id, "start_pickup"), act(agent, o.id, "start_pickup")]);
  assert.equal([x, y].filter((r) => r.status === 200).length, 1, `${x.status} / ${y.status}`);
});

test("E-L10: a wrong weight can be corrected before settle", async () => {
  const c = await as("customer");
  const admin = await as("admin");
  const o = await book(c, { method: "cod" });
  await drivePickup(o.id, "weighed", { weight: 3 });
  const again = await act(admin, o.id, "weigh", { actual_weight: 2 });
  assert.equal(again.status, 200, `re-weigh refused: ${again.status} ${again.text}`);
});

test("E-L11: ops override out_for_pickup → picked_up still issues a hub code", async () => {
  const c = await as("customer");
  const admin = await as("admin");
  const agent = await as("agentA");
  const o = await book(c, { method: "cod" });
  await drivePickup(o.id, "out_for_pickup");
  await mustAct(admin, o.id, "override_handover", { reason: "Customer phone dead" });
  const { data } = await sb().from("order_handover_codes").select("kind").eq("order_id", o.id).eq("kind", "hub");
  // The agent must be able to finish without ops regenerating a code by hand.
  assert.ok((data ?? []).length > 0, "no hub code issued after override");
  void agent;
});

test("E-L12: unknown action → 400, illegal action → 403", async () => {
  const c = await as("customer");
  const o = await book(c, { method: "cod" });
  assert.equal((await act(c, o.id, "teleport")).status, 400);
  assert.equal((await act(c, o.id, "weigh", { actual_weight: 1 })).status, 403);
});

// ── handover codes ──────────────────────────────────────────────────────────

test("E-H1a: five wrong handover codes lock it (sequential)", async () => {
  const [c, agent] = await Promise.all([as("customer"), as("agentA")]);
  const o = await book(c, { method: "cod" });
  await drivePickup(o.id, "out_for_pickup");
  const right = await codeFor(c, o.id);
  const wrong = right === "0000" ? "1111" : "0000";
  for (let i = 0; i < 5; i++) await act(agent, o.id, "mark_picked_up", { otp: wrong });
  const r = await act(agent, o.id, "mark_picked_up", { otp: right });
  assert.notEqual(r.status, 200, "right code accepted after 5 wrong");
});

test("E-H1b: ten PARALLEL wrong handover codes still lock it", async () => {
  const [c, agent] = await Promise.all([as("customer"), as("agentA")]);
  const o = await book(c, { method: "cod" });
  await drivePickup(o.id, "out_for_pickup");
  const right = await codeFor(c, o.id);
  const wrongs = Array.from({ length: 10 }, (_, i) => String((Number(right) + 1 + i) % 10000).padStart(4, "0"));
  await Promise.all(wrongs.map((w) => act(agent, o.id, "mark_picked_up", { otp: w })));
  const { data } = await sb().from("order_handover_codes").select("attempts, locked_at").eq("order_id", o.id).eq("kind", "pickup");
  const r = await act(agent, o.id, "mark_picked_up", { otp: right });
  assert.notEqual(r.status, 200, `10 parallel wrong guesses → row ${JSON.stringify(data)}; right code then accepted`);
});

// ── cancellations ───────────────────────────────────────────────────────────

test("E-C1/C2/C3: cancellation rules", async () => {
  const [c, admin] = await Promise.all([as("customer"), as("admin")]);
  const o = await book(c, { method: "cod" });
  assert.equal((await act(admin, o.id, "reject_cancellation", { note: "no" })).status, 403, "C3: decline with nothing open");
  await mustAct(c, o.id, "request_cancellation", {});
  assert.equal((await act(c, o.id, "request_cancellation", {})).status, 403, "C2: second open request");
  await mustAct(admin, o.id, "reject_cancellation", { note: "Already packed" });
  await mustAct(c, o.id, "request_cancellation", {});
  await mustAct(admin, o.id, "cancel");
  assert.equal((await reload(o.id)).status, "cancelled");

  const late = await book(c, { method: "cod" });
  await drivePickup(late.id, "picked_up");
  assert.equal((await act(c, late.id, "request_cancellation", {})).status, 403, "C1: cancel after pickup");
});

// ── access control ──────────────────────────────────────────────────────────

test("E-X1: role matrix on ops and agent APIs", async () => {
  const [cust, agent, admin] = await Promise.all([as("customer"), as("agentA"), as("admin")]);
  const anon = new Client();
  const ops = ["/api/ops/orders", "/api/ops/payments", "/api/ops/customers", "/api/ops/users", "/api/ops/beats", "/api/ops/applications"];
  const agentPaths = ["/api/agent/pickups/available", "/api/agent/pickups/mine", "/api/agent/collections"];
  const bad: string[] = [];
  for (const p of ops) {
    if ((await anon.get(p)).status !== 401) bad.push(`anon ${p}`);
    if ((await cust.get(p)).status !== 403) bad.push(`customer ${p}`);
    if ((await agent.get(p)).status !== 403) bad.push(`agent ${p}`);
    if ((await admin.get(p)).status !== 200) bad.push(`admin ${p} ≠ 200`);
  }
  for (const p of agentPaths) {
    if ((await anon.get(p)).status !== 401) bad.push(`anon ${p}`);
    if ((await cust.get(p)).status !== 403) bad.push(`customer ${p}`);
    if ((await admin.get(p)).status !== 403) bad.push(`admin ${p}`);
  }
  const o = await book(cust, { method: "cod" });
  if ((await act(admin, o.id, "claim")).status !== 403) bad.push("admin claimed a pickup");
  if ((await act(cust, o.id, "claim")).status !== 403) bad.push("customer claimed a pickup");
  assert.deepEqual(bad, []);
});

test("E-X2: a customer cannot see, act on, or mint codes for another customer's order", async () => {
  const [c1, c2] = await Promise.all([as("customer"), as("customer2")]);
  const o = await book(c1, { method: "pay_at_dropoff", pickup: false });
  const bad: string[] = [];
  const view = await c2.get(`/api/orders/${o.order_no}`);
  if (view.status !== 404) bad.push(`view → ${view.status}`);
  const cancel = await act(c2, o.id, "request_cancellation", {});
  if (cancel.status !== 404) bad.push(`cancel → ${cancel.status}`);
  const code = await c2.post(`/api/orders/${o.id}/handover-code`);
  if (code.status !== 404) bad.push(`code → ${code.status}`);
  const pay = await c2.post("/api/payments/test/settle", { order_id: o.id });
  if (pay.status !== 404) bad.push(`pay → ${pay.status}`);
  assert.deepEqual(bad, []);
});

// ── booking validation ──────────────────────────────────────────────────────

test("E-B1: pickup without a date, and mismatched pay method, are refused", async () => {
  const c = await as("customer");
  assert.equal((await c.post("/api/orders", bookingBody({ date: null }))).status, 400);
  assert.equal((await c.post("/api/orders", bookingBody({ method: "pay_at_dropoff" }))).status, 400);
  assert.equal((await c.post("/api/orders", bookingBody({ pickup: false, method: "pay_at_pickup" }))).status, 400);
});

test("E-B2: unserviceable pincode and a date before the cutoff are refused", async () => {
  const c = await as("customer");
  const far = await c.post("/api/orders", bookingBody({ pincode: "799001" }));
  assert.equal(far.status, 409, far.text);
  const past = await c.post("/api/orders", bookingBody({ date: istDate(-1) }));
  assert.equal(past.status, 409, past.text);
});

test("E-B3: malformed or far-future pickup dates are refused", async () => {
  const c = await as("customer");
  const bad = await c.post("/api/orders", bookingBody({ date: "2099-9-1" }));
  const year = await c.post("/api/orders", bookingBody({ date: istDate(400) }));
  assert.equal(bad.status, 400, `"2099-9-1" → ${bad.status}`);
  assert.equal(year.status, 400, `+400 days → ${year.status}`);
});

test("E-B4: the same booking submitted twice at once makes one order", async () => {
  const c = await as("customer");
  const body = bookingBody({ method: "cod" });
  const [x, y] = await Promise.all([c.post("/api/orders", body), c.post("/api/orders", body)]);
  const ok = [x, y].filter((r) => r.status === 200).length;
  assert.equal(ok, 1, `double submit created ${ok} orders`);
});

test("E-B5: items and consignee of the wrong shape are refused", async () => {
  const c = await as("customer");
  const body = { ...bookingBody({ method: "cod" }), items: { junk: true }, consignee: { x: 1 } };
  const r = await c.post("/api/orders", body);
  assert.equal(r.status, 400, `junk items/consignee → ${r.status}`);
});

test("E-R1: rates refuses a non-positive or non-numeric weight", async () => {
  const c = await as("customer");
  const base = { product_code: "EXP", destination_code: "US", origin_code: "BOM", pcs: 1, booking_date: istDate(0) };
  const bad: string[] = [];
  for (const w of [-1, 0, "abc"]) {
    const r = await c.post("/api/rates", { ...base, actual_weight: w });
    if (r.status !== 400) bad.push(`${JSON.stringify(w)} → ${r.status}`);
  }
  assert.deepEqual(bad, []);
});
