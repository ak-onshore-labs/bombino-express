import { test } from "node:test";
import assert from "node:assert/strict";

import { latestScan } from "./carrierStatus.js";

test("latestScan picks the newest scan by time, not array order", () => {
  const latest = latestScan([
    { event_at: "2026-11-15T17:53:43Z", event_state: "delivered" },
    { event_at: "2026-11-10T07:45:00Z", event_state: "entry" },
    { event_at: "2026-11-13T09:00:00Z", event_state: "INTRANSIT" },
  ]);
  assert.deepEqual(latest, { state: "delivered", at: "2026-11-15T17:53:43Z" });
});

test("latestScan skips stateless rows and returns null when none", () => {
  assert.equal(latestScan([{ event_at: "2026-11-15T17:53:43Z" }, null, "x"]), null);
  assert.equal(latestScan([]), null);
});

import { shouldAutoDispatch } from "./carrierStatus.js";
import { carrierHasParcel } from "../shared/carrierState.js";

test("ITD past booking moves an order still short of dispatched (BOM-100347)", () => {
  const delivered = { state: "delivered", at: "2026-11-15T17:53:43Z" };
  for (const status of ["pickup_requested", "out_for_pickup", "picked_up", "awaiting_dropoff", "received_at_hub", "weighed", "settled"]) {
    assert.equal(shouldAutoDispatch(status, delivered), true, status);
  }
  assert.equal(shouldAutoDispatch("received_at_hub", { state: "INTRANSIT", at: "" }), true);
});

test("no auto-dispatch on ITD's booking entry, a cancelled docket, or no scan", () => {
  assert.equal(shouldAutoDispatch("awaiting_dropoff", { state: "entry", at: "" }), false);
  assert.equal(shouldAutoDispatch("received_at_hub", { state: "CANCELLED", at: "" }), false);
  assert.equal(shouldAutoDispatch("received_at_hub", null), false);
});

test("already dispatched or cancelled orders are never moved", () => {
  const delivered = { state: "DELIVERED", at: "" };
  assert.equal(shouldAutoDispatch("dispatched", delivered), false);
  assert.equal(shouldAutoDispatch("cancelled", delivered), false);
});

test("carrierHasParcel ignores case and spacing", () => {
  assert.equal(carrierHasParcel("  Entry "), false);
  assert.equal(carrierHasParcel("in  scan"), true);
  assert.equal(carrierHasParcel(""), false);
});
