import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatBiaReply,
  inboundText,
  maskedName,
  suggestionPart,
  NOT_ME_ID,
  USE_ACCOUNT_ID,
  type WaPart,
} from "./whatsappBiaFormat.js";
import type { BiaCard } from "./biaCards.js";

const APP = "https://bombino.example";
const PHONE = "+91 22 6640 0000";

function fmt(message: string, suggestions: string[] = [], cards: BiaCard[] = [], appUrl = APP): WaPart[] {
  return formatBiaReply({ message, suggestions, cards, appUrl, supportPhone: PHONE });
}

test("tokens never reach the customer as text; they become website links", () => {
  const parts = fmt("Your pickup code is on the order page. TAP_VIEW_ORDER:BOM-100200#handover-code");
  assert.equal(parts.length, 1);
  const cta = parts[0];
  assert.equal(cta?.kind, "cta");
  if (cta?.kind !== "cta") return;
  assert.equal(cta.body, "Your pickup code is on the order page.");
  assert.equal(cta.label, "See your code");
  assert.equal(cta.url, `${APP}/order/BOM-100200#handover-code`);
  assert.ok(!JSON.stringify(parts).includes("TAP_"));
});

test("a second link follows as its own message; more than two are dropped", () => {
  const parts = fmt("Options. TAP_TRACK:1234567890 TAP_MY_ORDERS TAP_CREATE_SHIPMENT");
  assert.deepEqual(
    parts.map((p) => (p.kind === "cta" ? p.url : p.kind)),
    [`${APP}/shipment/1234567890`, `${APP}/orders`]
  );
});

test("contact us becomes the phone number, not a link", () => {
  const [part] = fmt("I can't do that from here. TAP_CONTACT_US");
  assert.equal(part?.kind, "text");
  assert.match(part?.kind === "text" ? part.body : "", /call \+91 22 6640 0000/);
});

test("no website configured: links are named in the text instead", () => {
  const [part] = fmt("Book it here. TAP_CREATE_SHIPMENT", [], [], "");
  assert.equal(part?.kind, "text");
  assert.match(part?.kind === "text" ? part.body : "", /Open the Bombino app for: Book a shipment/);
});

test("short suggestions ride on the answer as quick-reply buttons", () => {
  const parts = fmt("Here you go.", ["Track a parcel", "Get rates"]);
  assert.deepEqual(parts, [
    {
      kind: "buttons",
      body: "Here you go.",
      buttons: [
        { id: "s:Track a parcel", title: "Track a parcel" },
        { id: "s:Get rates", title: "Get rates" },
      ],
    },
  ]);
});

test("long or many suggestions become a list", () => {
  const p = suggestionPart("Anything else?", ["What documents do I need for a company account?", "Rates"]);
  assert.equal(p?.kind, "list");
  if (p?.kind !== "list") return;
  assert.equal(p.rows[0]?.id, "s:What documents do I need for a company account?");
  assert.ok((p.rows[0]?.title.length ?? 0) <= 24);
});

test("cards are written out under the answer", () => {
  const [part] = fmt("Your orders:", [], [
    { kind: "order", orderNo: "BOM-100200", awb: "1234567890", destination: "New York, US", status: "Picked up", tone: "blue", bookedOn: "3 Sep", href: "/order/BOM-100200" },
  ]);
  const body = part?.kind === "text" ? part.body : "";
  assert.match(body, /\*BOM-100200\* · Picked up/);
  assert.match(body, /To New York, US · AWB 1234567890 · booked 3 Sep/);
});

test("a long answer is split, and the buttons go on the last piece", () => {
  const long = Array.from({ length: 60 }, (_, i) => `Line ${i} with some words in it to fill the message.`).join("\n");
  const parts = fmt(long, ["More"]);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every((p) => p.body.length <= 4096));
  assert.equal(parts.at(-1)?.kind, "buttons");
});

test("taps read back as the question, or as the identity choice", () => {
  assert.deepEqual(inboundText("s:Track a parcel"), { kind: "text", text: "Track a parcel" });
  assert.deepEqual(inboundText(NOT_ME_ID), { kind: "not_me" });
  assert.deepEqual(inboundText(USE_ACCOUNT_ID), { kind: "use_account" });
  assert.deepEqual(inboundText("  where is my parcel "), { kind: "text", text: "where is my parcel" });
});

test("names are masked for the greeting", () => {
  assert.equal(maskedName("Aditya Kamarouthu"), "A***** K.");
  assert.equal(maskedName("Ravi"), "R*** ".trim());
  assert.equal(maskedName(""), null);
});

test("an order the answer already names is not repeated as a card", () => {
  const card: BiaCard = { kind: "order", orderNo: "BOM-100200", awb: null, destination: "—", status: "Pickup requested", tone: "gray", bookedOn: "18 Sep", href: null };
  const [named] = fmt("1. BOM-100200 - Pickup requested", [], [card]);
  assert.equal(named?.kind === "text" ? named.body : "", "1. BOM-100200 - Pickup requested");
  const [unnamed] = fmt("Your latest order:", [], [card]);
  const body = unnamed?.kind === "text" ? unnamed.body : "";
  assert.match(body, /\*BOM-100200\* · Pickup requested\nbooked 18 Sep/);
  assert.doesNotMatch(body, /To —/);
});

test("order links say which order", () => {
  const parts = fmt("Two orders. TAP_VIEW_ORDER:BOM-100200 TAP_VIEW_ORDER:BOM-100201");
  assert.deepEqual(parts.map((p) => (p.kind === "cta" ? `${p.body}|${p.label}` : p.kind)), [
    "Two orders.|Open BOM-100200",
    "Or: Open BOM-100201|Open BOM-100201",
  ]);
});
