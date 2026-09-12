import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BIA_CARDS,
  biaCardKey,
  isBiaCard,
  parseBiaCards,
  toneForOrderStatus,
  type DocUploadCard,
  type OrderCard,
} from "./biaCards.js";

test("an upload card names a known endpoint and document, and never a whole number", () => {
  const account: DocUploadCard = {
    kind: "docUpload",
    target: "account",
    slot: "aadhaar_card",
    documentType: null,
    label: "Aadhaar Card",
    numberEnding: "2346",
    needsNumber: false,
  };
  const kyc: DocUploadCard = { ...account, target: "kyc", slot: null, documentType: "Aadhaar Number", needsNumber: true };
  assert.equal(isBiaCard(account), true);
  assert.equal(isBiaCard(kyc), true);
  assert.equal(isBiaCard({ ...account, numberEnding: "234123412346" }), false, "a whole Aadhaar");
  assert.equal(isBiaCard({ ...account, target: "signup" }), false, "no signup uploads from chat");
  assert.equal(isBiaCard({ ...account, slot: "passport" }), false);
  assert.equal(isBiaCard({ ...account, documentType: "Aadhaar Number" }), false, "an account card has a slot, not a type");
  assert.equal(isBiaCard({ ...kyc, documentType: "Ration Card" }), false);
  assert.equal(isBiaCard({ ...kyc, url: "https://evil.example/upload" }), true, "extra fields are ignored; the client never reads a URL");
  assert.notEqual(biaCardKey(account), biaCardKey(kyc));
});

const order: OrderCard = {
  kind: "order",
  orderNo: "BOM-100108",
  awb: null,
  destination: "Sunnyvale, United States",
  status: "Pickup confirmed",
  tone: "blue",
  bookedOn: "10 Aug",
  href: "/order/BOM-100108",
};

test("a well-formed card passes", () => {
  assert.equal(isBiaCard(order), true);
  assert.equal(
    isBiaCard({ kind: "pickup", pincode: "400053", place: "Andheri, Mumbai", available: true, cutoff: "7 PM", earliest: "today", outOfCity: false, counters: [], state: null }),
    true
  );
  assert.equal(
    isBiaCard({ kind: "rate", destination: "United Kingdom", weightKg: 2, services: [{ name: "Bombino SELF", amount: 1712.18 }], bookable: true }),
    true
  );
});

test("a card cannot link out of the app", () => {
  for (const href of [
    "https://evil.example/order/BOM-100108",
    "javascript:alert(1)",
    "//evil.example",
    "/order/../admin",
    "/order/BOM-100108?x=1",
    "/ops/orders",
  ]) {
    assert.equal(isBiaCard({ ...order, href }), false, href);
  }
  for (const href of ["/order/BOM-100108", "/shipment/AB12CD34", "/orders", null]) {
    assert.equal(isBiaCard({ ...order, href }), true, String(href));
  }
});

test("unknown kinds, tones and shapes are rejected", () => {
  assert.equal(isBiaCard({ ...order, kind: "script" }), false);
  assert.equal(isBiaCard({ ...order, tone: "purple" }), false);
  assert.equal(isBiaCard({ ...order, status: 7 }), false);
  assert.equal(isBiaCard(null), false);
});

test("parseBiaCards keeps the good ones and caps the list", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ ...order, orderNo: `BOM-10010${i}` }));
  assert.equal(parseBiaCards([...many, { kind: "bad" }]).length, MAX_BIA_CARDS);
  assert.deepEqual(parseBiaCards("nope"), []);
});

test("hub statuses share one colour, as they share one label", () => {
  for (const status of ["received_at_hub", "weighed", "settled", "ready_for_docket"]) {
    assert.equal(toneForOrderStatus(status), "amber", status);
  }
  assert.equal(toneForOrderStatus("dispatched"), "green");
  assert.equal(toneForOrderStatus("cancelled"), "red");
  assert.equal(toneForOrderStatus("agent_accepted", { overdue: true }), "orange");
});
