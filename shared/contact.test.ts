import { test } from "node:test";
import assert from "node:assert/strict";

import { isValidReceiverPhone, toIndianMobile, withoutTrunkZero } from "./contact.js";

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

test("a +1 receiver number needs ten digits and an area code from 2-9", () => {
  assert.equal(isValidReceiverPhone("+12125550100"), true);
  assert.equal(isValidReceiverPhone("+1 (212) 555-0100"), true);
  assert.equal(isValidReceiverPhone("+109198332075"), false);
  assert.equal(isValidReceiverPhone("+1212555010"), false);
  assert.equal(isValidReceiverPhone("+11125550100"), false);
});

test("receiver numbers outside +1 are not judged here", () => {
  assert.equal(isValidReceiverPhone("+442079460958"), true);
  assert.equal(isValidReceiverPhone("+97150123456"), true);
});

test("iOS contact autofill keeps the number, not the country code", () => {
  // What iOS pastes from the contact card: "+91 755-8372885".
  assert.equal(toIndianMobile("+91 755-8372885"), "7558372885");
  assert.equal(toIndianMobile("+91 75583 72885"), "7558372885");
});
