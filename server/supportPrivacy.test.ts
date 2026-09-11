import { test } from "node:test";
import assert from "node:assert/strict";
import { maskSensitive } from "./supportPrivacy.js";

test("an Aadhaar reaches the model as its last four", () => {
  assert.equal(maskSensitive("my aadhaar is 1234 5678 9012"), "my aadhaar is ••••9012");
  assert.equal(maskSensitive("Aadhar: 234567890123"), "Aadhar: ••••0123");
  assert.equal(maskSensitive("UID 2345-6789-0123 please"), "UID ••••0123 please");
});

test("the card's 4-4-4 grouping is masked even without the word", () => {
  assert.equal(maskSensitive("it's 4321 8765 2109"), "it's ••••2109");
});

test("a bare 12-digit number is left alone: it is usually an AWB", () => {
  assert.equal(maskSensitive("track 123456789012"), "track 123456789012");
  assert.equal(maskSensitive("where is BOM-100231"), "where is BOM-100231");
});

test("a PAN is masked in any case", () => {
  assert.equal(maskSensitive("PAN ABCDE1234F"), "PAN ••••234F");
  assert.equal(maskSensitive("my pan is abcde1234f"), "my pan is ••••234F");
});

test("a bank account number is masked when named as one", () => {
  assert.equal(maskSensitive("account no: 000123456789"), "account no: ••••6789");
  assert.equal(maskSensitive("a/c 12345678901234"), "a/c ••••1234");
});

test("ordinary messages are untouched", () => {
  for (const text of [
    "How much to send 2 kg to London?",
    "Is pickup available at 400053?",
    "My phone is 9876543210",
    "AWB AB12CD34 please",
  ]) {
    assert.equal(maskSensitive(text), text);
  }
});
