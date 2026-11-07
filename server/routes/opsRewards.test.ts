import { test } from "node:test";
import assert from "node:assert/strict";

import { adjustBodySchema, monthSchema } from "./opsRewards.js";

test("a manual adjustment needs whole, non-zero points and a reason", () => {
  assert.equal(adjustBodySchema.safeParse({ points: 50, note: "Goodwill for late pickup" }).success, true);
  assert.equal(adjustBodySchema.safeParse({ points: -20, note: "Duplicate earn on BOM-100231" }).success, true);
  assert.equal(adjustBodySchema.safeParse({ points: 0, note: "Nothing at all" }).success, false);
  assert.equal(adjustBodySchema.safeParse({ points: 2.5, note: "Half a point" }).success, false);
  assert.equal(adjustBodySchema.safeParse({ points: 10, note: "  ok  " }).success, false);
  assert.equal(adjustBodySchema.safeParse({ points: 10 }).success, false);
  assert.equal(adjustBodySchema.safeParse({ points: 100_001, note: "Too many points" }).success, false);
});

test("the reason is stored trimmed", () => {
  const r = adjustBodySchema.parse({ points: 5, note: "   Goodwill gesture   " });
  assert.equal(r.note, "Goodwill gesture");
});

test("the ledger export takes a calendar month", () => {
  assert.equal(monthSchema.safeParse("2026-11").success, true);
  assert.equal(monthSchema.safeParse("2026-13").success, false);
  assert.equal(monthSchema.safeParse("2026-1").success, false);
  assert.equal(monthSchema.safeParse(undefined).success, false);
});
