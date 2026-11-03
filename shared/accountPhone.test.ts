import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_PHONE_COUNTRIES,
  accountPhoneToMsisdn,
  formatAccountPhone,
  isAccountPhone,
  isInternationalPhone,
  msisdnToAccountPhone,
  splitAccountPhone,
  toAccountPhone,
} from "./contact.js";

test("Indian numbers keep their bare 10-digit shape", () => {
  assert.equal(toAccountPhone("IN", "+91 98765 43210"), "9876543210");
  assert.equal(isAccountPhone("9876543210"), true);
  assert.equal(isInternationalPhone("9876543210"), false);
});

test("India is first and every country is offered once", () => {
  assert.equal(ACCOUNT_PHONE_COUNTRIES[0].iso, "IN");
  const isos = ACCOUNT_PHONE_COUNTRIES.map((c) => c.iso);
  assert.equal(new Set(isos).size, isos.length);
  assert.ok(isos.length > 200);
  for (const iso of ["QA", "AE", "US", "GB", "SG", "AU"]) assert.ok(isos.includes(iso), iso);
});

test("a number from abroad is stored with + and its dial code", () => {
  assert.equal(toAccountPhone("QA", "5011 3086"), "+97450113086");
  assert.equal(toAccountPhone("QA", "+974 5011 3086"), "+97450113086");
  assert.equal(toAccountPhone("AE", "050 123 4567"), "+971501234567");
  assert.equal(toAccountPhone("GB", "07400 123456"), "+447400123456");
  assert.equal(toAccountPhone("US", "(212) 555-0100"), "+12125550100");
  for (const n of ["+97450113086", "+971501234567", "+447400123456", "+12125550100", "+6591234567"]) {
    assert.equal(isAccountPhone(n), true, n);
  }
});

test("half-typed, malformed or +91 numbers are not international", () => {
  assert.equal(isAccountPhone("+9745011308"), false);
  assert.equal(isAccountPhone("+97450113086123"), false);
  assert.equal(isAccountPhone("+919876543210"), false);
  assert.equal(isAccountPhone("97450113086"), false);
  assert.equal(isAccountPhone("+"), false);
});

test("split and format round-trip", () => {
  const qa = splitAccountPhone("+97450113086");
  assert.equal(qa.country.iso, "QA");
  assert.equal(qa.local, "50113086");
  assert.equal(splitAccountPhone("9876543210").country.iso, "IN");
  // Half typed +1: the country the picker is on wins.
  assert.equal(splitAccountPhone("+1416", "CA").country.iso, "CA");
  assert.equal(formatAccountPhone("+97450113086"), "+974 5011 3086");
  assert.equal(formatAccountPhone("9876543210"), "+91 98765 43210");
});

test("msisdn both ways", () => {
  assert.equal(accountPhoneToMsisdn("9876543210"), "919876543210");
  assert.equal(accountPhoneToMsisdn("+97450113086"), "97450113086");
  assert.equal(accountPhoneToMsisdn("+12125550100"), "12125550100");
  assert.equal(accountPhoneToMsisdn("+9745011"), null);
  assert.equal(msisdnToAccountPhone("919876543210"), "9876543210");
  assert.equal(msisdnToAccountPhone("97450113086"), "+97450113086");
  assert.equal(msisdnToAccountPhone("12125550100"), "+12125550100");
  assert.equal(msisdnToAccountPhone("911234567890"), null);
});
