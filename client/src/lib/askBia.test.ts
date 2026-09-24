import { test } from "node:test";
import assert from "node:assert/strict";
import { askBiaAbout, screenForPath, seedForError } from "./askBia.js";
import { useBiaStore } from "./biaStore.js";

test("each customer path maps to its screen", () => {
  assert.deepEqual(screenForPath("/order/bom-100108"), { surface: "order", orderNo: "BOM-100108" });
  assert.deepEqual(screenForPath("/create"), { surface: "create" });
  assert.deepEqual(screenForPath("/orders"), { surface: "orders" });
  assert.deepEqual(screenForPath("/guest-profile/setup"), { surface: "guest_profile" });
  assert.deepEqual(screenForPath("/shipment/AB12CD34"), { surface: "track" });
  assert.deepEqual(screenForPath("/profile"), { surface: "documents" });
  assert.deepEqual(screenForPath("/somewhere-new"), { surface: "home" });
});

test("a catalogued error is asked about by its title", () => {
  assert.equal(
    seedForError("PAY_AT_PICKUP_NEEDS_PICKUP", "Pay at pickup is only available when an agent collects the parcel"),
    'I got this error: "Pay at pickup needs a doorstep pickup". What do I do?'
  );
});

test("an uncatalogued error is asked about in the words on screen", () => {
  assert.equal(seedForError(null, "Please select a product type"), 'I got this message: "Please select a product type". What do I do?');
  assert.equal(seedForError("FORBIDDEN", "  spaced   out  "), 'I got this message: "spaced out". What do I do?');
  const long = seedForError(null, "x".repeat(500)) ?? "";
  assert.ok(long.length < 260, "long messages are cut");
  assert.equal(seedForError(null, "   "), undefined);
});

test("asking BIA opens the sheet with the code in the screen, and only a catalogued one", () => {
  askBiaAbout({ surface: "create", step: "payment" }, "PICKUP_DATE_REQUIRED", "pickup_date is required");
  let state = useBiaStore.getState();
  assert.equal(state.open, true);
  assert.deepEqual(state.screen, { surface: "create", step: "payment", errorCode: "PICKUP_DATE_REQUIRED" });
  assert.equal(state.seed, 'I got this error: "Choose a pickup date". What do I do?');
  const first = state.requestId;

  askBiaAbout({ surface: "signup", step: "otp" }, "NOT_A_REAL_CODE", "Something odd");
  state = useBiaStore.getState();
  assert.deepEqual(state.screen, { surface: "signup", step: "otp" });
  assert.equal(state.requestId, first + 1, "each ask is a new request");
  state.closeBia();
  assert.equal(useBiaStore.getState().open, false);
});
