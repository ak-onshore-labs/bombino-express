import { test } from "node:test";
import assert from "node:assert/strict";

import { chooseWhatsappTarget, whatsappReachOf } from "./whatsappAlt.js";
import { isTestOtpNumber } from "./otp.js";
import { toWaMsisdn } from "./whatsapp.js";

const QA = "+97450123456";
const ALT = "9876543210";

test("no alternate: updates go to the sign-in number", () => {
  assert.equal(chooseWhatsappTarget(QA, null, "not_on_whatsapp"), QA);
  assert.equal(chooseWhatsappTarget(QA, null, "on_whatsapp"), QA);
});

test("sign-in number not on WhatsApp: updates go to the Indian alternate", () => {
  assert.equal(chooseWhatsappTarget(QA, ALT, "not_on_whatsapp"), ALT);
});

test("sign-in number on WhatsApp (or not yet known): the alternate is only a backup", () => {
  assert.equal(chooseWhatsappTarget(QA, ALT, "on_whatsapp"), QA);
  assert.equal(chooseWhatsappTarget(QA, ALT, "unknown"), QA);
});

test("a number from abroad is never a test account", () => {
  // Same last ten digits as a listed test number, but from Qatar.
  assert.equal(isTestOtpNumber("9000000011"), true);
  assert.equal(isTestOtpNumber("+97490000000"), false);
});

test("the listed test number from abroad takes the public code, by exact match only", () => {
  assert.equal(isTestOtpNumber("+12025550123"), true);
  assert.equal(isTestOtpNumber("+1 202-555-0123"), true);
  // Same last ten digits, but Indian or another country: not a test number.
  assert.equal(isTestOtpNumber("2025550123"), false);
  assert.equal(isTestOtpNumber("+12025550124"), false);
});

test("the test number from abroad reads as not on WhatsApp, so it is asked for an Indian one", async () => {
  assert.equal(await whatsappReachOf("+12025550123"), "not_on_whatsapp");
});

test("WhatsApp takes any valid number with its own dial code", () => {
  assert.equal(toWaMsisdn(QA), "97450123456");
  assert.equal(toWaMsisdn("97450123456"), "97450123456");
  assert.equal(toWaMsisdn("9876543210"), "919876543210");
  assert.equal(toWaMsisdn("+12125550100"), "12125550100");
  assert.equal(toWaMsisdn("+9745011"), null);
});
