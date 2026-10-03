import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRateBoxes } from "./itd.js";

test("a sized box and a weight-only box (all sizes 0) are both accepted", () => {
  assert.deepEqual(parseRateBoxes([{ length_cm: 30, width_cm: 20, height_cm: 20, weight_kg: 5 }]), [
    { length_cm: 30, width_cm: 20, height_cm: 20, weight_kg: 5 },
  ]);
  assert.deepEqual(parseRateBoxes([{ length_cm: 0, width_cm: 0, height_cm: 0, weight_kg: 5 }]), [
    { length_cm: 0, width_cm: 0, height_cm: 0, weight_kg: 5 },
  ]);
});

test("a box with only some sizes, no weight, or a negative size is refused", () => {
  assert.equal(parseRateBoxes([{ length_cm: 30, width_cm: 0, height_cm: 0, weight_kg: 5 }]), undefined);
  assert.equal(parseRateBoxes([{ length_cm: 0, width_cm: 0, height_cm: 0, weight_kg: 0 }]), undefined);
  assert.equal(parseRateBoxes([{ length_cm: -1, width_cm: 20, height_cm: 20, weight_kg: 5 }]), undefined);
  assert.equal(parseRateBoxes([]), undefined);
});
