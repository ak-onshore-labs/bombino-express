import { test } from "node:test";
import assert from "node:assert/strict";

import { isValidReceiverPhone, toIndianMobile, withoutDialCode, withoutTrunkZero } from "./contact.js";

test("a bare 10-digit mobile is kept as-is", () => {
  assert.equal(toIndianMobile("7558372885"), "7558372885");
});

test("a +91 or 0 prefix is dropped, not the last digits", () => {
  for (const input of ["+91 7558372885", "917558372885", "07558372885", "+91 07558372885", "0917558372885"]) {
    assert.equal(toIndianMobile(input), "7558372885", input);
  }
});

test("typing a +91 number digit by digit ends on the right number", () => {
  let value = "";
  for (const ch of "917558372885") value = toIndianMobile(value + ch);
  assert.equal(value, "7558372885");
});

test("a number that starts with 91 itself is not cut", () => {
  assert.equal(toIndianMobile("9198332075"), "9198332075");
});

test("a receiver's trunk zero is dropped before the dial code goes on", () => {
  assert.equal(withoutTrunkZero("09198332075"), "9198332075");
  assert.equal(withoutTrunkZero("9198332075"), "9198332075");
  assert.equal(withoutTrunkZero("020 7946 0958"), "2079460958");
});

test("a receiver number is accepted as typed, 6 to 15 digits", () => {
  assert.equal(isValidReceiverPhone("9198332075"), true);
  assert.equal(isValidReceiverPhone("09198332075"), true);
  assert.equal(isValidReceiverPhone("+109198332075"), true);
  assert.equal(isValidReceiverPhone("(212) 555-0100"), true);
  assert.equal(isValidReceiverPhone("+442079460958"), true);
  assert.equal(isValidReceiverPhone("12345"), false);
  assert.equal(isValidReceiverPhone("1234567890123456"), false);
  assert.equal(isValidReceiverPhone(""), true);
});

test("older orders show the receiver number without the added dial code", () => {
  assert.equal(withoutDialCode("+19198332075", "+1"), "9198332075");
  assert.equal(withoutDialCode("+971501234567", "+971"), "501234567");
  assert.equal(withoutDialCode("9198332075", "+1"), "9198332075");
  assert.equal(withoutDialCode("+19198332075", null), "+19198332075");
});

test("iOS contact autofill keeps the number, not the country code", () => {
  // What iOS pastes from the contact card: "+91 755-8372885".
  assert.equal(toIndianMobile("+91 755-8372885"), "7558372885");
  assert.equal(toIndianMobile("+91 75583 72885"), "7558372885");
});
