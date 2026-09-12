import { test } from "node:test";
import assert from "node:assert/strict";

// No shared database and no OpenAI from unit tests: the credentials may be in
// the shell's environment, so they go before anything creates a client.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.DATABASE_URL;
delete process.env.OPENAI_API_KEY;

const { memoryCaseStore, openSupportCase, replaceCaseStore, summarizeForCase } = await import("./supportCases.js");
const { executeEscalateSupport, executeGetSupportCase } = await import("./supportGeneral.js");
type Ctx = import("./supportTypes.js").SupportChatContext;

const base: Ctx = {
  user: null,
  itdToken: null,
  dbUserId: null,
  sessionId: null,
  guestRef: null,
  guestPhone: null,
  screen: null,
};
const guest: Ctx = { ...base, guestRef: "11111111-1111-4111-8111-111111111111", guestPhone: "9000000091" };
const talk = [
  { role: "user" as const, content: "My parcel BOM-100136 arrived with the box crushed and the vase broken." },
  { role: "assistant" as const, content: "I'm sorry to hear that." },
  { role: "user" as const, content: "I want a refund. My aadhaar is 2341 2341 2346." },
];

test("a second escalation for the same owner and order finds the open case", async () => {
  const store = memoryCaseStore();
  replaceCaseStore(store);
  try {
    const owner = { kind: "guest" as const, guestRef: "g1" };
    const first = await openSupportCase({ owner, orderNo: "BOM-100136", category: "damaged", transcript: talk, turnId: null });
    const again = await openSupportCase({ owner, orderNo: "BOM-100136", category: "damaged", transcript: talk, turnId: null });
    const other = await openSupportCase({ owner, orderNo: null, category: "other", transcript: talk, turnId: null });
    assert.equal(first.caseNo, "BIA-1001");
    assert.equal(first.existing, false);
    assert.equal(again.caseNo, "BIA-1001");
    assert.equal(again.existing, true);
    assert.equal(other.caseNo, "BIA-1002", "a different order (or none) is a different case");
    assert.equal(store.cases.length, 2);
    // Identity numbers are masked in what the case keeps.
    assert.doesNotMatch(JSON.stringify(store.cases[0].transcript), /2341 2341 2346/);
    assert.doesNotMatch(store.cases[0].summary, /2341/);
  } finally {
    replaceCaseStore(null);
  }
});

test("without the model, the summary is still three plain lines naming the order", async () => {
  const summary = await summarizeForCase(talk, "BOM-100136", null);
  const lines = summary.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "BOM-100136");
  assert.doesNotMatch(summary, /2341 2341/);
});

test("with handoff off, escalating is the contact buttons and nothing else", async () => {
  const store = memoryCaseStore();
  replaceCaseStore(store);
  try {
    const out = await executeEscalateSupport({ category: "damaged" }, { ...guest, modules: ["orders"], transcript: talk });
    assert.match(out.content, /Nothing has been sent to the team/);
    assert.match(out.content, /TAP_CONTACT_US/);
    assert.equal(out.cards, undefined);
    assert.equal(store.cases.length, 0);
  } finally {
    replaceCaseStore(null);
  }
});

test("with handoff on, a guest gets a case, its card and its WhatsApp button; an order that isn't theirs isn't named", async () => {
  const store = memoryCaseStore();
  replaceCaseStore(store);
  try {
    // No database here, so no order can be proved theirs: the case names none.
    const out = await executeEscalateSupport(
      { order_no: "BOM-999999", category: "damaged" },
      { ...guest, modules: ["orders", "handoff"], transcript: talk, turnId: "22222222-2222-4222-8222-222222222222" }
    );
    assert.match(out.content, /Case BIA-1001 is open\./);
    assert.match(out.content, /isn't on their phone number/);
    assert.match(out.content, /TAP_CASE_WHATSAPP:BIA-1001/);
    assert.doesNotMatch(out.content, /BOM-999999/);
    assert.deepEqual(out.caseNos, ["BIA-1001"]);
    assert.equal(out.cards?.[0]?.kind, "case");
    assert.equal(store.cases[0].orderNo, null);
    assert.equal(store.cases[0].turnId, "22222222-2222-4222-8222-222222222222");
  } finally {
    replaceCaseStore(null);
  }
});

test("a signed-out visitor gets no case, and a store that fails falls back to the buttons", async () => {
  const anonOut = await executeEscalateSupport({}, { ...base, modules: ["orders", "handoff"] });
  assert.match(anonOut.content, /no case can be opened/);
  assert.equal(anonOut.cards, undefined);

  replaceCaseStore({
    findOpen: async () => null,
    insert: async () => {
      throw new Error('relation "support_cases" does not exist');
    },
    listForOwner: async () => [],
  });
  try {
    const out = await executeEscalateSupport({}, { ...guest, modules: ["orders", "handoff"], transcript: talk });
    assert.match(out.content, /TAP_CONTACT_US/);
    assert.equal(out.cards, undefined);
  } finally {
    replaceCaseStore(null);
  }
});

test("BIA reads back only the caller's own cases, with our team's reply in the card", async () => {
  const store = memoryCaseStore();
  replaceCaseStore(store);
  try {
    const mine = { kind: "guest" as const, guestRef: guest.guestRef! };
    const theirs = { kind: "guest" as const, guestRef: "22222222-2222-4222-8222-222222222222" };
    await openSupportCase({ owner: mine, orderNo: "BOM-100136", category: "damaged", transcript: talk, turnId: null });
    await openSupportCase({ owner: theirs, orderNo: null, category: "other", transcript: talk, turnId: null });
    Object.assign(store.cases[0], { status: "answered", reply: "Please send photos of the box on WhatsApp.", answeredAt: new Date().toISOString() });

    const out = await executeGetSupportCase({ case_no: "bia 1001" }, guest);
    assert.match(out.content, /Case BIA-1001 \(Damaged parcel, BOM-100136\).*answered/);
    assert.match(out.content, /to quote word for word: "Please send photos of the box on WhatsApp\."/);
    assert.match(out.content, /TAP_CASE_WHATSAPP:BIA-1001/);
    assert.deepEqual(out.caseNos, ["BIA-1001"]);
    const card = out.cards?.[0];
    assert.equal(card?.kind, "case");
    assert.equal(card?.kind === "case" ? card.reply : undefined, "Please send photos of the box on WhatsApp.");

    // Someone else's case number is simply not theirs.
    const other = await executeGetSupportCase({ case_no: "BIA-1002" }, guest);
    assert.match(other.content, /no case BIA-1002/);
    assert.equal(other.cards, undefined);

    // No number: their latest cases.
    const latest = await executeGetSupportCase({}, guest);
    assert.equal(latest.cards?.length, 1);

    // A closed case gets no WhatsApp button.
    store.cases[0].status = "closed";
    assert.doesNotMatch((await executeGetSupportCase({}, guest)).content, /TAP_CASE_WHATSAPP/);

    const anonOut = await executeGetSupportCase({ case_no: "BIA-1001" }, base);
    assert.match(anonOut.content, /can't be looked up/);
    assert.equal(anonOut.cards, undefined);
  } finally {
    replaceCaseStore(null);
  }
});

test("before the migration, looking a case up says so and offers WhatsApp", async () => {
  const out = await executeGetSupportCase({ case_no: "BIA-1001" }, guest);
  assert.match(out.content, /can't be looked up right now/);
  assert.match(out.content, /TAP_CONTACT_US/);
});
