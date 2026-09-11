import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKABLE_ORIGIN, isBookableCorridor } from "./corridor.js";

test("the app books from India", () => {
  assert.equal(BOOKABLE_ORIGIN, "IN");
});

test("India to anywhere else is bookable", () => {
  assert.equal(isBookableCorridor("IN", "GB"), true);
  assert.equal(isBookableCorridor("IN", "US"), true);
  assert.equal(isBookableCorridor("IN", "AE"), true);
});

test("India to India, and anything into India, is not", () => {
  assert.equal(isBookableCorridor("IN", "IN"), false);
  assert.equal(isBookableCorridor("US", "IN"), false);
  assert.equal(isBookableCorridor("GB", "US"), false);
});
