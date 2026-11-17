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
