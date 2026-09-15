import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidAadhaarNumber, validateAadhaar } from "./aadhaar.js";

test("by default an Aadhaar number needs 12 digits, no 0/1 prefix, and a valid Verhoeff digit", () => {
  assert.ok(validateAadhaar("2345 6789 0124").valid);
  assert.equal(validateAadhaar("123456789012").valid, false, "starts with 1");
  assert.equal(validateAadhaar("234567890123").valid, false, "fails Verhoeff");
  assert.equal(validateAadhaar("23456789012").valid, false, "11 digits");
});

test("with the check digits off (document checks bypassed) only the 12 digits are required", () => {
  const relaxed = { checkDigits: false };
  assert.ok(validateAadhaar("123456789012", relaxed).valid, "Cashfree sandbox's number goes through");
  assert.ok(validateAadhaar("234567890123", relaxed).valid, "a failing check digit goes through");
  assert.ok(isValidAadhaarNumber("0000 0000 0000", relaxed));
  assert.equal(validateAadhaar("12345678901", relaxed).valid, false, "still 12 digits");
  assert.equal(validateAadhaar("", relaxed).valid, false, "still required");
  assert.equal(validateAadhaar("12345678901a", relaxed).valid, false, "still digits only");
});
