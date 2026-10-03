import { test } from "node:test";
import assert from "node:assert/strict";
import { STATIC_COVERAGE } from "./pickupPincodes.js";
import { rateOriginFor, rateOriginNote } from "./rateOrigin.js";

test("Mumbai, Thane and Navi Mumbai pincodes are priced where they are", () => {
  for (const pin of ["400001", "400053"]) {
    assert.deepEqual(rateOriginFor(pin, STATIC_COVERAGE), { outsideMumbai: false }, pin);
  }
  const thane = Array.from(STATIC_COVERAGE.entries()).find(([, a]) => a.city === "Thane");
  const navi = Array.from(STATIC_COVERAGE.entries()).find(([, a]) => a.city === "Navi Mumbai");
  assert.ok(thane && navi, "coverage names Thane and Navi Mumbai");
  assert.equal(rateOriginFor(thane[0], STATIC_COVERAGE).outsideMumbai, false);
  assert.equal(rateOriginFor(navi[0], STATIC_COVERAGE).outsideMumbai, false);
});

test("a covered pincode in another city names that city", () => {
  assert.deepEqual(rateOriginFor("110001", STATIC_COVERAGE), { outsideMumbai: true, city: "Delhi" });
});

test("an uncovered pincode falls back to its prefix and the typed city", () => {
  assert.deepEqual(rateOriginFor("400999", STATIC_COVERAGE), { outsideMumbai: false });
  assert.deepEqual(rateOriginFor("682001", STATIC_COVERAGE, " Kochi "), { outsideMumbai: true, city: "Kochi" });
  assert.deepEqual(rateOriginFor("682001", STATIC_COVERAGE), { outsideMumbai: true, city: null });
});

test("a blank or part-typed pincode shows no note", () => {
  for (const pin of ["", "1100", null, undefined]) {
    assert.deepEqual(rateOriginFor(pin, STATIC_COVERAGE), { outsideMumbai: false });
  }
});

test("the note names the city when it is known", () => {
  assert.match(rateOriginNote("Delhi"), /from Delhi to Mumbai/);
  assert.doesNotMatch(rateOriginNote(null), /from null/);
});
