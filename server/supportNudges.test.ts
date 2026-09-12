import { test } from "node:test";
import assert from "node:assert/strict";

// No shared database from unit tests: the credentials may be in the shell's
// environment, so they go before anything creates a client.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.DATABASE_URL;

const { looksLikeSignup, memoryNudgeStore, nextDay, nudgesFrom, runNudgeSweep } = await import("./supportNudges.js");
type Snapshot = import("./supportNudges.js").NudgeSnapshot;
type NudgeOrder = import("./supportNudges.js").NudgeOrder;
type Nudge = import("./supportNudges.js").Nudge;

const NOW = Date.parse("2026-09-12T02:00:00Z"); // 07:30 in India
const TODAY = "2026-09-12";
const hoursAgo = (h: number): string => new Date(NOW - h * 3600_000).toISOString();

function order(fields: Partial<NudgeOrder>): NudgeOrder {
  return {
    id: "o1",
    order_no: "BOM-100200",
    user_id: "u1",
    guest_ref: null,
    guest_phone: null,
    status: "pickup_requested",
    pickup_request: 1,
    pickup_date: "2026-09-13",
    quoted_amount: 1000,
    final_amount: null,
    updated_at: hoursAgo(2),
    ...fields,
  };
}

function snapshot(fields: Partial<Snapshot> = {}): Snapshot {
  return {
    today: TODAY,
    nowMs: NOW,
    pickupsTomorrow: [],
    weighed: [],
    repriceSentOnWhatsapp: new Set(),
    documents: [],
    guestOrders: [],
    phonesWithAccount: new Set(),
    signups: [],
    ...fields,
  };
}

test("nextDay crosses months and years", () => {
  assert.equal(nextDay("2026-09-30"), "2026-10-01");
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
});

test("a doorstep pickup tomorrow, and only that", () => {
  const due = nudgesFrom(
    snapshot({
      pickupsTomorrow: [
        order({}),
        order({ id: "o2", pickup_date: "2026-09-14" }),
        order({ id: "o3", status: "picked_up" }),
        order({ id: "o4", pickup_request: 2 }),
        order({ id: "o5", user_id: null, guest_ref: "g1" }),
      ],
    })
  );
  assert.deepEqual(due.map((n) => n.subject), ["o1:2026-09-13", "o5:2026-09-13"]);
  assert.match(due[0].body, /order page/);
  assert.match(due[1].body, /WhatsApp/, "a guest has no order page");
  assert.equal(due[1].owner.kind, "guest");
});

test("a changed amount, unless WhatsApp already said so", () => {
  const weighed = [
    order({ id: "w1", status: "weighed", final_amount: 1250 }),
    order({ id: "w2", status: "settled", final_amount: 1000.4 }),
    order({ id: "w3", status: "weighed", final_amount: 900 }),
    order({ id: "w4", status: "dispatched", final_amount: 1300 }),
    order({ id: "w5", status: "weighed", final_amount: 1300, updated_at: hoursAgo(24 * 9) }),
  ];
  const due = nudgesFrom(snapshot({ weighed, repriceSentOnWhatsapp: new Set(["w3"]) }));
  assert.deepEqual(due.map((n) => n.subject), ["w1:1250"]);
  assert.match(due[0].body, /₹1,250/);
  assert.match(due[0].body, /estimate was ₹1,000/);
  assert.doesNotMatch(due[0].body, /₹250|owe/, "what's owed is for our team to say");
});

test("a failed document check, but never a bypassed, skipped or unchecked one", () => {
  const doc = (id: string, ocr_status: string | null, slot: string | null = "pan_card") => ({
    id,
    owner: { kind: "account" as const, userId: "u1" },
    slot,
    label: "PAN card",
    ocr_status,
    created_at: hoursAgo(3),
  });
  const due = nudgesFrom(
    snapshot({
      documents: [doc("d1", "mismatch"), doc("d2", "bypassed"), doc("d3", "skipped"), doc("d4", null), doc("d5", "match"), doc("d6", "unreadable", "electricity_bill")],
    })
  );
  assert.deepEqual(due.map((n) => n.subject), ["d1"]);
  assert.match(due[0].title, /PAN card needs replacing/);
});

test("a guest's quiet signup after a day, and a guest's third booking with no account", () => {
  const due = nudgesFrom(
    snapshot({
      signups: [
        { guestRef: "g1", lastActivityAt: hoursAgo(30) },
        { guestRef: "g2", lastActivityAt: hoursAgo(5) },
        { guestRef: "g3", lastActivityAt: hoursAgo(24 * 13) },
      ],
      guestOrders: [
        order({ id: "a", user_id: null, guest_ref: "g4", guest_phone: "9000000001" }),
        order({ id: "b", user_id: null, guest_ref: "g4", guest_phone: "9000000001" }),
        order({ id: "c", user_id: null, guest_ref: "g5", guest_phone: "9000000002" }),
        order({ id: "d", user_id: null, guest_ref: "g5", guest_phone: "9000000002" }),
        order({ id: "e", user_id: null, guest_ref: "g6" }),
      ],
      phonesWithAccount: new Set(["9000000002"]),
    })
  );
  assert.deepEqual(
    due.map((n) => `${n.kind}:${n.subject}`),
    ["signup_stuck:g1", "guest_account:once"]
  );
  assert.deepEqual(due[1].owner, { kind: "guest", guestRef: "g4" });
});

test("no nudge is marketing: about their own things, in plain words", () => {
  const due = nudgesFrom(
    snapshot({
      pickupsTomorrow: [order({})],
      weighed: [order({ id: "w1", status: "weighed", final_amount: 1250 })],
      signups: [{ guestRef: "g1", lastActivityAt: hoursAgo(30) }],
      guestOrders: [order({ id: "a", user_id: null, guest_ref: "g4" }), order({ id: "b", user_id: null, guest_ref: "g4" })],
    })
  );
  assert.equal(due.length, 4);
  for (const n of due) {
    assert.doesNotMatch(`${n.title} ${n.body}`, /offer|discount|% off|deal|free|limited|hurry|rate us|review|refer|!/i, n.kind);
  }
});

test("the sweep sends each nudge once, however often it runs", async () => {
  const store = memoryNudgeStore();
  const sent: Nudge[] = [];
  const notify = async (n: Nudge) => {
    sent.push(n);
    return true;
  };
  const s = snapshot({ pickupsTomorrow: [order({}), order({ id: "o2", user_id: "u2" })] });
  const first = await runNudgeSweep(s, { store, notify });
  const second = await runNudgeSweep(s, { store, notify });
  assert.deepEqual(first.sent, { pickup_tomorrow: 2 });
  assert.deepEqual(second.sent, {});
  assert.equal(sent.length, 2);
  assert.equal(second.skipped.oneADay + second.skipped.sentBefore, 2);

  // A day later, with the day's cap reset, the same failed document is still not news.
  const doc = { id: "d1", owner: { kind: "account" as const, userId: "u3" }, slot: "pan_card", label: "PAN card", ocr_status: "mismatch", created_at: hoursAgo(1) };
  await runNudgeSweep(snapshot({ documents: [doc] }), { store, notify });
  const later = await runNudgeSweep({ ...snapshot({ documents: [doc] }), today: nextDay(TODAY) }, { store, notify });
  assert.equal(later.skipped.sentBefore, 1);
  assert.equal(sent.length, 3);
});

test("one a day per person, the more useful kind first", async () => {
  const store = memoryNudgeStore();
  const sent: Nudge[] = [];
  const s = snapshot({
    pickupsTomorrow: [order({})],
    documents: [{ id: "d1", owner: { kind: "account", userId: "u1" }, slot: "pan_card", label: "PAN card", ocr_status: "mismatch", created_at: hoursAgo(1) }],
  });
  const report = await runNudgeSweep(s, { store, notify: async (n) => (sent.push(n), true) });
  assert.deepEqual(sent.map((n) => n.kind), ["document_failed"]);
  assert.equal(report.skipped.oneADay, 1);
  // The next day the pickup reminder goes (still for "tomorrow" in this snapshot).
  await runNudgeSweep({ ...s, today: nextDay(TODAY), pickupsTomorrow: [order({ pickup_date: nextDay(nextDay(TODAY)) })] }, { store, notify: async (n) => (sent.push(n), true) });
  assert.deepEqual(sent.map((n) => n.kind), ["document_failed", "pickup_tomorrow"]);
});

test("a kind they switched off is not sent; the rest still are", async () => {
  const store = memoryNudgeStore();
  await store.setOff({ kind: "account", userId: "u1" }, "pickup_tomorrow", true);
  const sent: Nudge[] = [];
  const report = await runNudgeSweep(snapshot({ pickupsTomorrow: [order({}), order({ id: "o2", user_id: "u2" })] }), {
    store,
    notify: async (n) => (sent.push(n), true),
  });
  assert.equal(report.skipped.optedOut, 1);
  assert.deepEqual(sent.map((n) => n.owner), [{ kind: "account", userId: "u2" }]);
  assert.deepEqual(await store.offFor({ kind: "account", userId: "u1" }), ["pickup_tomorrow"]);
  await store.setOff({ kind: "account", userId: "u1" }, "pickup_tomorrow", false);
  assert.deepEqual(await store.offFor({ kind: "account", userId: "u1" }), []);
});

test("a bell row that couldn't be written is tried again next time", async () => {
  const store = memoryNudgeStore();
  const s = snapshot({ pickupsTomorrow: [order({})] });
  const failed = await runNudgeSweep(s, { store, notify: async () => false });
  assert.equal(failed.skipped.notifyFailed, 1);
  const retried = await runNudgeSweep(s, { store, notify: async () => true });
  assert.deepEqual(retried.sent, { pickup_tomorrow: 1 });
});

test("before the migration the sweep stops before sending anything", async () => {
  let notified = 0;
  await assert.rejects(runNudgeSweep(snapshot({ pickupsTomorrow: [order({})] }), { notify: async () => (notified++, true) }));
  assert.equal(notified, 0);
});

test("a guest's one identity document isn't a signup; two documents, a GSTIN, or Aadhaar and PAN is", () => {
  const set = (...xs: string[]) => new Set(xs);
  assert.equal(looksLikeSignup(set("aadhaar_card"), set("aadhaar")), false);
  assert.equal(looksLikeSignup(set("pan_card"), set()), false);
  assert.equal(looksLikeSignup(set("aadhaar_card", "pan_card"), set()), true);
  assert.equal(looksLikeSignup(set(), set("gstin")), true);
  assert.equal(looksLikeSignup(set(), set("aadhaar", "pan")), true);
});

test("a document our checker couldn't reach isn't the customer's to replace", () => {
  const due = nudgesFrom(
    snapshot({
      documents: [{ id: "d1", owner: { kind: "guest", guestRef: "g1" }, slot: null, label: "Aadhaar", ocr_status: "unavailable", created_at: hoursAgo(2) }],
    })
  );
  assert.deepEqual(due, []);
});
