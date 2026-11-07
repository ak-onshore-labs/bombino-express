import { test } from "node:test";
import assert from "node:assert/strict";

import { latestTrackingState } from "./rewardsDelivery.js";

test("the latest scan wins, by time, whatever order ITD lists them in", () => {
  const events = [
    { event_at: "2026-11-20T10:00:00Z", event_state: "DELIVERED" },
    { event_at: "2026-11-18T10:00:00Z", event_state: "DRS" },
    { event_at: "2026-11-10T10:00:00Z", event_state: "INTRANSIT" },
  ];
  assert.equal(latestTrackingState(events), "DELIVERED");
  assert.equal(latestTrackingState([...events].reverse()), "DELIVERED");
});

test("no scans, no state", () => {
  assert.equal(latestTrackingState([]), null);
  assert.equal(latestTrackingState([{ event_at: "2026-11-10T10:00:00Z" }, null, "x"]), null);
});
