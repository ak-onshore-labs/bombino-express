/**
 * End-to-end journeys from docs/final-phase/markdowns/roles-and-flows.md §3,
 * walked through the API as each real role, checking what the customer sees
 * at every step.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { isValidAadhaarNumber } from "../../shared/aadhaar.js";
import {
  Client,
  OTP,
  PHONES,
  TAG,
  act,
  as,
  book,
  bookingBody,
  cleanup,
  codeFor,
  drivePickup,
  mustAct,
  reload,
  resetOtpHistory,
  sb,
  startServer,
  stopServer,
} from "./harness.js";

const INTERNAL = ["weighed", "settled", "ready_for_docket"];
let guestRef: string | null = null;

before(() => startServer());
after(async () => {
  await cleanup();
  if (guestRef) {
    await sb().from("kyc_documents").delete().eq("guest_ref", guestRef);
    await sb().from("account_documents").delete().eq("signup_ref", guestRef);
    await sb().from("identity_verifications").delete().eq("signup_ref", guestRef);
    await sb().from("guest_profiles").delete().eq("guest_ref", guestRef);
  }
  await resetOtpHistory(PHONES.guest);
  await stopServer();
});

/** What the customer's own screen is given for this order. */
async function customerView(c: Client, orderNo: string): Promise<string> {
  const r = await c.get(`/api/orders/${orderNo}`);
  assert.equal(r.status, 200, `customer view: ${r.text}`);
  return r.text;
}

function assertNoInternalStatus(text: string, step: string) {
  for (const s of INTERNAL) {
    assert.ok(!text.includes(`"status":"${s}"`), `customer view leaks internal status "${s}" at ${step}`);
  }
}

test("Flow A: personal account, pickup, pay now — booked to in transit", async () => {
  const c = await as("customer");
  const admin = await as("admin");
  const o = await book(c, { method: "pay_now", amount: 2000, weight: 2 });
  assert.equal(o.status, "pickup_requested");
  assert.equal(o.awb_no, null, "no tracking number before dispatch");

  const settle = await c.post("/api/payments/test/settle", { order_id: o.id });
  assert.equal(settle.status, 200, settle.text);
  assert.equal((await reload(o.id)).payment_status, "paid");

  await drivePickup(o.id, "received_at_hub");
  const agent = await as("agentA");
  const mine = await agent.get("/api/agent/pickups/mine");
  assert.ok(!mine.text.includes(o.id), "job still on the agent's list after the hub");

  await mustAct(admin, o.id, "weigh", { actual_weight: 2 });
  assertNoInternalStatus(await customerView(c, o.order_no), "weighed");
  await mustAct(admin, o.id, "settle");
  assertNoInternalStatus(await customerView(c, o.order_no), "settled");
  await mustAct(admin, o.id, "generate_docket");
  const done = await reload(o.id);
  assert.equal(done.status, "dispatched");
  assert.ok(done.awb_no, "no AWB after docket");
  assert.ok((await customerView(c, o.order_no)).includes(done.awb_no!), "customer can't see the tracking number");

  const notes = await c.get<{ notifications?: { title: string; data?: { order_id?: string; status?: string } }[] }>(
    "/api/notifications"
  );
  const mineNotes = (notes.json.notifications ?? []).filter((n) => n.data?.order_id === o.id);
  const statuses = mineNotes.map((n) => n.data?.status);
  for (const s of INTERNAL) assert.ok(!statuses.includes(s), `customer notified about internal "${s}"`);
  assert.ok(statuses.includes("dispatched"), `no dispatch notification (got ${statuses.join(", ")})`);
});

test("Flow B: drop-off, pay at the hub counter", async () => {
  const c = await as("customer");
  const admin = await as("admin");
  const o = await book(c, { pickup: false, method: "pay_at_dropoff", amount: 1500, weight: 2 });
  assert.equal(o.status, "awaiting_dropoff");

  const code = await codeFor(c, o.id);
  const wrong = await act(admin, o.id, "mark_received_dropoff", { otp: code === "0000" ? "1111" : "0000" });
  assert.notEqual(wrong.status, 200, "wrong drop-off code accepted");
  await mustAct(admin, o.id, "mark_received_dropoff", { otp: code });
  await mustAct(admin, o.id, "weigh", { actual_weight: 3 });

  const early = await act(admin, o.id, "settle");
  assert.notEqual(early.status, 200, "settled before the counter payment");

  const w = await reload(o.id);
  await mustAct(admin, o.id, "collect_payment", { amount: Number(w.final_amount), collection_mode: "cash" });
  await mustAct(admin, o.id, "settle");
  await mustAct(admin, o.id, "generate_docket");
  assert.equal((await reload(o.id)).status, "dispatched");
});

test("Flow C: COD settles without money and ships", async () => {
  const c = await as("customer");
  const o = await book(c, { method: "cod", amount: 1000, weight: 1 });
  const done = await drivePickup(o.id, "dispatched", { weight: 3 });
  assert.equal(done.status, "dispatched");
  const final = await reload(o.id);
  assert.ok(Number(final.final_amount) > 1000, "COD reprice not recorded");
});

test("Flow: cancellation — request, decline, request again, approve", async () => {
  const c = await as("customer");
  const admin = await as("admin");
  const o = await book(c, { method: "cod" });
  await mustAct(c, o.id, "request_cancellation", { reason: "Changed my mind" });
  await mustAct(admin, o.id, "reject_cancellation", { note: "Already on the way" });
  assert.equal((await reload(o.id)).status, "pickup_requested");
  await mustAct(c, o.id, "request_cancellation", {});
  await mustAct(admin, o.id, "cancel");
  assert.equal((await reload(o.id)).status, "cancelled");
  const agent = await as("agentA");
  const avail = await agent.get("/api/agent/pickups/available");
  assert.ok(!avail.text.includes(o.id), "cancelled job still offered to agents");
});

test("Flow: guest — verify phone, identity, book, see it on the guest profile", async () => {
  await resetOtpHistory(PHONES.guest);
  const g = new Client("guest");
  assert.equal((await g.post("/api/auth/otp/request", { phone: PHONES.guest, purpose: "auth" })).status, 200);
  const cont = await g.post("/api/auth/phone/continue", { phone: PHONES.guest, code: OTP });
  assert.equal(cont.status, 200, cont.text);

  // Guest booking without identity is refused (E-B6).
  const noKyc = await g.post("/api/orders", {
    ...bookingBody({ method: "cod", phone: PHONES.guest }),
    contract_accepted: true,
    contract_signed_name: "Guest Person",
  });
  assert.equal(noKyc.status, 422, `guest booked with no KYC: ${noKyc.status} ${noKyc.text}`);

  let aadhaar = "";
  for (let d = 0; d < 10; d++) if (isValidAadhaarNumber(`23412341234${d}`)) aadhaar = `23412341234${d}`;
  const id = await g.post("/api/signup/identity/aadhaar", { phone: PHONES.guest, aadhaar_number: aadhaar });
  assert.equal(id.status, 200, id.text);

  const form = new FormData();
  form.append("phone", PHONES.guest);
  // The booking flow's identity step: /api/kyc/upload, owned by the guest ref.
  form.append("document_type", "Aadhaar Number");
  form.append("document_no", aadhaar);
  form.append("file", new Blob([Buffer.from("%PDF-1.4\n% e2e\n")], { type: "application/pdf" }), "aadhaar.pdf");
  const up = await g.call("POST", "/api/kyc/upload", form);
  assert.equal(up.status, 200, `upload: ${up.text}`);

  const noContract = await g.post("/api/orders", bookingBody({ method: "cod", phone: PHONES.guest }));
  assert.equal(noContract.status, 422, "guest booked without signing the contract");

  const booked = await g.post<{ order: { id: string; order_no: string } }>("/api/orders", {
    ...bookingBody({ method: "cod", phone: PHONES.guest }),
    contract_accepted: true,
    contract_signed_name: "Guest Person",
  });
  assert.equal(booked.status, 200, booked.text);
  const { data } = await sb().from("orders").select("guest_ref").eq("id", booked.json.order.id).single();
  guestRef = (data?.guest_ref as string) ?? null;

  const profile = await g.get("/api/guest/profile");
  assert.equal(profile.status, 200, profile.text);
  assert.ok(profile.text.includes(booked.json.order.order_no), "order missing from the guest profile");

  // An existing account's number can't book as a guest (E-B6).
  const stolen = await g.post("/api/orders", {
    ...bookingBody({ method: "cod", phone: PHONES.customer }),
    contract_accepted: true,
    contract_signed_name: "Guest Person",
  });
  assert.ok([401, 409].includes(stolen.status), `guest booked on an account's number: ${stolen.status}`);
  void TAG;
});

test("E-K1: uploads over 4MB and non-documents are refused", async () => {
  const g = new Client("guest-k1");
  await resetOtpHistory(PHONES.guest);
  await g.post("/api/auth/otp/request", { phone: PHONES.guest, purpose: "auth" });
  await g.post("/api/auth/phone/continue", { phone: PHONES.guest, code: OTP });

  const big = new FormData();
  big.append("phone", PHONES.guest);
  big.append("doc_slot", "electricity_bill");
  big.append("file", new Blob([Buffer.alloc(5 * 1024 * 1024, 1)], { type: "application/pdf" }), "big.pdf");
  assert.equal((await g.call("POST", "/api/signup/documents", big)).status, 413);

  const exe = new FormData();
  exe.append("phone", PHONES.guest);
  exe.append("doc_slot", "electricity_bill");
  exe.append("file", new Blob([Buffer.from("MZ\x90\x00this is a windows program")], { type: "application/pdf" }), "bill.pdf");
  const r = await g.call("POST", "/api/signup/documents", exe);
  const stored = (r.json as { capability_id?: string }).capability_id;
  if (stored) await sb().from("account_documents").delete().eq("capability_id", stored);
  assert.equal(r.status, 400, `an .exe labelled application/pdf was stored: ${r.status}`);
});
