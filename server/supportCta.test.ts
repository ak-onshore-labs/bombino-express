import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeReply, tokensIn, type CtaContext } from "./supportCta.js";

// A uuid nobody owns anything under. With or without a database configured,
// an order lookup for it finds nothing, so these tests need no fixtures.
const NOBODY = "00000000-0000-4000-8000-000000000000";
const account = (owned: string[] = []): CtaContext => ({
  owner: { kind: "account", userId: NOBODY },
  ownedOrderNos: new Set(owned),
});
const guest = (owned: string[] = []): CtaContext => ({
  owner: { kind: "guest", guestRef: NOBODY },
  ownedOrderNos: new Set(owned),
});
const anon: CtaContext = { owner: null, ownedOrderNos: new Set() };

/** The button lines at the end of a finalized reply. */
function buttons(reply: string): string[] {
  return reply.split("\n").filter((line) => line.startsWith("TAP_"));
}

test("tokensIn finds every token in order", () => {
  assert.deepEqual(tokensIn("a TAP_MY_ORDERS b\nTAP_VIEW_ORDER:BOM-100231"), [
    "TAP_MY_ORDERS",
    "TAP_VIEW_ORDER:BOM-100231",
  ]);
});

test("a token written with a space after its colon leaves nothing stray behind", async () => {
  const reply = await finalizeReply("You're nearly done.\nTAP_VIEW_ORDER: BOM-100231\nTAP_CONTACT_US", anon);
  assert.equal(reply, "You're nearly done.\n\nTAP_CONTACT_US");
  // A colon inside a sentence is left alone.
  assert.equal(await finalizeReply("Two things: a bill, and a letter.", anon), "Two things: a bill, and a letter.");
});

test("an order the tool proved the caller owns keeps its button, moved to the end", async () => {
  const reply = await finalizeReply("See TAP_VIEW_ORDER:BOM-100231 for details.", account(["BOM-100231"]));
  assert.equal(reply, "See  for details.\n\nTAP_VIEW_ORDER:BOM-100231");
});

test("a button for someone else's order is dropped (eval #23)", async () => {
  const reply = await finalizeReply(
    "Here.\nTAP_VIEW_ORDER:BOM-100001\nTAP_VIEW_ORDER:BOM-100231",
    account(["BOM-100231"])
  );
  assert.deepEqual(buttons(reply), ["TAP_VIEW_ORDER:BOM-100231"]);
});

test("a guest never gets an order-page button, having no order page", async () => {
  const reply = await finalizeReply("TAP_VIEW_ORDER:BOM-100136\nTAP_MY_ORDERS", guest(["BOM-100136"]));
  assert.deepEqual(buttons(reply), ["TAP_MY_ORDERS"]);
});

test("Cancellations is for accounts, the guest profile for guests", async () => {
  const text = "x\nTAP_CANCELLATIONS\nTAP_GUEST_PROFILE";
  assert.deepEqual(buttons(await finalizeReply(text, account())), ["TAP_CANCELLATIONS"]);
  assert.deepEqual(buttons(await finalizeReply(text, guest())), ["TAP_GUEST_PROFILE"]);
  assert.deepEqual(buttons(await finalizeReply(text, anon)), []);
});

test("unknown tokens go, duplicates collapse, and at most six survive", async () => {
  const text = [
    "x",
    "TAP_BOGUS",
    "TAP_CONTACT_US",
    "TAP_CONTACT_US",
    "TAP_MY_ORDERS",
    "TAP_CREATE_SHIPMENT",
    "TAP_LOCATIONS",
    "TAP_TRACK:AWB1",
    "TAP_TRACK:AWB2",
    "TAP_TRACK:AWB3",
  ].join("\n");
  const kept = buttons(await finalizeReply(text, anon));
  assert.equal(kept.length, 6);
  assert.ok(!kept.includes("TAP_BOGUS"));
  assert.equal(kept.filter((b) => b === "TAP_CONTACT_US").length, 1);
});

test("a tracking button must look like an AWB", async () => {
  assert.deepEqual(buttons(await finalizeReply("x TAP_TRACK:ab12cd34", anon)), ["TAP_TRACK:AB12CD34"]);
  assert.deepEqual(buttons(await finalizeReply("x TAP_TRACK:a", anon)), []);
});

test("a locations button keeps a real state and drops anything odd", async () => {
  assert.deepEqual(buttons(await finalizeReply("x TAP_LOCATIONS:Tamil%20Nadu", anon)), [
    "TAP_LOCATIONS:Tamil%20Nadu",
  ]);
  assert.deepEqual(buttons(await finalizeReply("x TAP_LOCATIONS:%3Cscript%3E", anon)), ["TAP_LOCATIONS"]);
});

test("markdown and an echoed 'Buttons' label are cleaned out of the text", async () => {
  const reply = await finalizeReply("## Status\n**Arrived** at hub\nButtons:\nTAP_MY_ORDERS", anon);
  assert.equal(reply, "Status\nArrived at hub\n\nTAP_MY_ORDERS");
});

test("the last tool's buttons stand in only when the reply has none", async () => {
  const withFallback = { ...anon, fallbackTokens: ["TAP_CREATE_SHIPMENT"] };
  assert.deepEqual(buttons(await finalizeReply("Rates are ...", withFallback)), ["TAP_CREATE_SHIPMENT"]);
  assert.deepEqual(buttons(await finalizeReply("Rates are ...\nTAP_CONTACT_US", withFallback)), ["TAP_CONTACT_US"]);
});

test("a case's WhatsApp button survives only for a case this turn opened, and only for an owner", async () => {
  const opened = { ...guest(), ownedCaseNos: new Set(["BIA-1001"]) };
  assert.equal(await finalizeReply("Case BIA-1001 is open.\nTAP_CASE_WHATSAPP:BIA-1001", opened), "Case BIA-1001 is open.\n\nTAP_CASE_WHATSAPP:BIA-1001");
  // A number the model made up, or one from another turn, is dropped.
  assert.equal(await finalizeReply("See TAP_CASE_WHATSAPP:BIA-1002", opened), "See");
  assert.equal(await finalizeReply("TAP_CASE_WHATSAPP:BIA-1001", { ...anon, ownedCaseNos: new Set(["BIA-1001"]) }), "");
  assert.equal(await finalizeReply("TAP_CASE_WHATSAPP:BIA-1001", guest()), "");
});
