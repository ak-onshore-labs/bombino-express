import { test } from "node:test";
import assert from "node:assert/strict";
import { TtlCache } from "./postalLookup.js";

test("returns a stored value until it expires", () => {
  const c = new TtlCache<string>(1000, 10);
  c.set("k", "v", 0);
  assert.equal(c.get("k", 999), "v");
  assert.equal(c.get("k", 1000), null, "expired at ttl");
  assert.equal(c.size(), 0, "an expired read removes the entry");
});

test("evicts the oldest entry past the cap", () => {
  const c = new TtlCache<number>(60_000, 3);
  c.set("a", 1, 0);
  c.set("b", 2, 0);
  c.set("c", 3, 0);
  c.set("d", 4, 0);
  assert.equal(c.size(), 3);
  assert.equal(c.get("a", 1), null, "oldest evicted");
  assert.equal(c.get("d", 1), 4);
});

test("re-setting a key refreshes its age, so it isn't the next evicted", () => {
  const c = new TtlCache<number>(60_000, 2);
  c.set("a", 1, 0);
  c.set("b", 2, 0);
  c.set("a", 10, 0);
  c.set("c", 3, 0);
  assert.equal(c.get("b", 1), null, "b is now the oldest and goes");
  assert.equal(c.get("a", 1), 10);
});
