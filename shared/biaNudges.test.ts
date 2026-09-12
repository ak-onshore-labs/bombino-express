import { test } from "node:test";
import assert from "node:assert/strict";
import { NUDGE_KINDS, NUDGE_SPECS, isNudgeKind, nudgeKindsFor, nudgeSeed } from "./biaNudges.js";

test("an account never sees the guest-only kinds", () => {
  assert.deepEqual(nudgeKindsFor("account"), ["document_failed", "amount_changed", "pickup_tomorrow"]);
  assert.deepEqual(nudgeKindsFor("guest"), [...NUDGE_KINDS]);
  assert.equal(isNudgeKind("weekly_offers"), false);
});

test("every kind has a switch and a question for BIA, naming the order when there is one", () => {
  for (const kind of NUDGE_KINDS) {
    assert.ok(NUDGE_SPECS[kind].label && NUDGE_SPECS[kind].hint, kind);
    assert.match(nudgeSeed(kind, null), /\?$/, kind);
  }
  assert.match(nudgeSeed("pickup_tomorrow", "BOM-100200"), /BOM-100200/);
  assert.match(nudgeSeed("amount_changed", "BOM-100200"), /BOM-100200/);
});
