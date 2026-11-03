import { test } from "node:test";
import assert from "node:assert/strict";

import {
  accountPhoneToMsisdn,
  formatAccountPhone,
  isAccountPhone,
  isInternationalPhone,
  msisdnToAccountPhone,
  splitAccountPhone,
  toAccountPhone,
} from "./contact.js";

test("Indian numbers keep their bare 10-digit shape", () => {
  assert.equal(toAccountPhone("91", "+91 98765 43210"), "9876543210");
  assert.equal(isAccountPhone("9876543210"), true);
  assert.equal(isInternationalPhone("9876543210"), false);
});

test("a Qatar number is stored with + and its dial code", () => {
  assert.equal(toAccountPhone("974", "5012 3456"), "+97450123456");
  assert.equal(toAccountPhone("974", "+974 5012 3456"), "+97450123456");
  assert.equal(toAccountPhone("974", "050123456"), "+97450123456");
  assert.equal(isAccountPhone("+97450123456"), true);
});

test("wrong length or an unlisted country is refused", () => {
  assert.equal(isAccountPhone("+9745012345"), false);
  assert.equal(isAccountPhone("+974501234567"), false);
  assert.equal(isAccountPhone("+12125550100"), false);
  assert.equal(isAccountPhone("+919876543210"), false);
  assert.equal(isAccountPhone("97450123456"), false);
});

test("split and format round-trip", () => {
  const qa = splitAccountPhone("+97450123456");
  assert.equal(qa.country.iso, "QA");
  assert.equal(qa.local, "50123456");
  assert.equal(splitAccountPhone("9876543210").country.iso, "IN");
  assert.equal(formatAccountPhone("+97450123456"), "+974 5012 3456");
  assert.equal(formatAccountPhone("9876543210"), "+91 98765 43210");
});

test("msisdn both ways", () => {
  assert.equal(accountPhoneToMsisdn("9876543210"), "919876543210");
  assert.equal(accountPhoneToMsisdn("+97450123456"), "97450123456");
  assert.equal(accountPhoneToMsisdn("+12125550100"), null);
  assert.equal(msisdnToAccountPhone("919876543210"), "9876543210");
  assert.equal(msisdnToAccountPhone("97450123456"), "+97450123456");
  assert.equal(msisdnToAccountPhone("12125550100"), null);
});
