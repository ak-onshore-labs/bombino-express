import { test } from "node:test";
import assert from "node:assert/strict";

import { chooseWhatsappTarget, whatsappReachOf } from "./whatsappAlt.js";
import { isTestOtpNumber } from "./otp.js";
import { toWaMsisdn } from "./whatsapp.js";
import { receiverWhatsappAltOf } from "../shared/receiving.js";

const QA = "+97450123456";
const ALT = "9876543210";

const CHOSEN = { altPhone: ALT, useForUpdates: true };
const STANDBY = { altPhone: ALT, useForUpdates: false };

test("no second number: updates go to the sign-in number", () => {
  assert.equal(chooseWhatsappTarget(QA, null, "not_on_whatsapp"), QA);
  assert.equal(chooseWhatsappTarget(QA, null, "on_whatsapp"), QA);
  assert.equal(chooseWhatsappTarget("9876500000", null, "unknown"), "9876500000");
});

test("second number chosen for updates: it gets them, wherever the sign-in number is", () => {
  assert.equal(chooseWhatsappTarget(QA, CHOSEN, "on_whatsapp"), ALT);
  assert.equal(chooseWhatsappTarget(QA, CHOSEN, "unknown"), ALT);
  // An Indian sign-in number can have one too.
  assert.equal(chooseWhatsappTarget("9876500000", CHOSEN, "on_whatsapp"), ALT);
});

test("customer chose their own number: it gets updates, unless it is not on WhatsApp", () => {
  assert.equal(chooseWhatsappTarget(QA, STANDBY, "on_whatsapp"), QA);
  assert.equal(chooseWhatsappTarget(QA, STANDBY, "unknown"), QA);
  assert.equal(chooseWhatsappTarget(QA, STANDBY, "not_on_whatsapp"), ALT);
});

test("a second number from abroad works the same way", () => {
  const uae = { altPhone: "+971501234567", useForUpdates: true };
  assert.equal(chooseWhatsappTarget("9876500000", uae, "not_on_whatsapp"), "+971501234567");
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

test("a receiver's second number from the booking, and which one gets updates", () => {
  assert.deepEqual(receiverWhatsappAltOf({ whatsapp_alt_phone: "+971501234567" }), {
    altPhone: "+971501234567",
    useForUpdates: true,
  });
  assert.deepEqual(receiverWhatsappAltOf({ whatsapp_alt_phone: "9876543210", whatsapp_use_alt: false }), {
    altPhone: "9876543210",
    useForUpdates: false,
  });
  assert.equal(receiverWhatsappAltOf({ whatsapp_alt_phone: "12" }), null);
  assert.equal(receiverWhatsappAltOf({}), null);
});
