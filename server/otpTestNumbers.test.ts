import { test } from "node:test";
import assert from "node:assert/strict";

import { generateOtp, isTestOtpNumber, TEST_OTP_CODE } from "./otp.js";

test("test accounts are recognised in any common format", () => {
  assert.equal(isTestOtpNumber("9000000012"), true);
  assert.equal(isTestOtpNumber("+91 90000 00014"), true);
  assert.equal(isTestOtpNumber("919000000090"), true);
});

test("only the exact numbers listed, never a range", () => {
  assert.equal(isTestOtpNumber("9000000099"), false);
  assert.equal(isTestOtpNumber("7558372885"), false);
});

test("every account on the sheet's Test Accounts tab is listed", () => {
  for (const phone of [
    "9000000011", "9000000010", "9000000090", "9000000016", "9000000095", "9000000014", "9000000012",
    "9000000013", "9000000001", "9000000031", "9000000055", "9898989898", "9797979797", "9000000096",
  ]) {
    assert.equal(isTestOtpNumber(phone), true, phone);
  }
});

test("a test account gets 121212 and anyone else a random code", () => {
  const saved = process.env.OTP_FIXED_CODE;
  delete process.env.OTP_FIXED_CODE;
  try {
    assert.equal(generateOtp("9000000014"), TEST_OTP_CODE);
    const codes = [1, 2, 3, 4].map(() => generateOtp("7000000001"));
    assert.ok(codes.every((c) => /^\d{6}$/.test(c)));
    assert.ok(codes.some((c) => c !== TEST_OTP_CODE));
  } finally {
    if (saved !== undefined) process.env.OTP_FIXED_CODE = saved;
  }
});
