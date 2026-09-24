import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKING_ERROR_CODES, executeExplainBookingError, executeExplainBookingTerm } from "./supportBooking.js";
import type { SupportChatContext } from "./supportTypes.js";
import { PRODUCT_TYPES, PRODUCT_TYPE_INFO } from "../shared/bookingTerms.js";
import { ERROR_CATALOG } from "../shared/errorCatalog.js";

const anon: SupportChatContext = {
  user: null,
  itdToken: null,
  dbUserId: null,
  sessionId: null,
  guestRef: null,
  guestPhone: null,
  screen: null,
};

test("every booking and payment error is explainable, and nothing else is offered", () => {
  assert.ok(BOOKING_ERROR_CODES.includes("PICKUP_PINCODE_NOT_SERVICEABLE"));
  assert.ok(BOOKING_ERROR_CODES.includes("PRODUCT_TYPE_REQUIRED"));
  assert.ok(BOOKING_ERROR_CODES.includes("ALREADY_PAID"));
  assert.ok(!BOOKING_ERROR_CODES.includes("OCR_UNREADABLE" as never), "a document error belongs to the documents module");
  for (const code of BOOKING_ERROR_CODES) {
    const out = executeExplainBookingError({ code }, anon).content;
    assert.ok(out.includes(ERROR_CATALOG[code].fix), code);
  }
});

test("a booking error keeps its button, and the one on screen is used when none is named", () => {
  assert.match(executeExplainBookingError({ code: "PICKUP_PINCODE_NOT_SERVICEABLE" }, anon).content, /TAP_LOCATIONS/);
  const onScreen = executeExplainBookingError({}, { ...anon, screen: { surface: "create", errorCode: "PICKUP_DATE_TOO_EARLY" } });
  assert.match(onScreen.content, /cut-off/);
  assert.match(executeExplainBookingError({ code: "OCR_UNREADABLE" }, anon).content, /word for word/);
});

test("the glossary uses the booking form's own product-type words", () => {
  for (const type of PRODUCT_TYPES) {
    const name = type === "CSB V" ? "CSB_V" : type;
    assert.ok(executeExplainBookingTerm({ term: name }).content.includes(PRODUCT_TYPE_INFO[type].body), type);
  }
  assert.match(executeExplainBookingTerm({ term: "IGST" }).content, /Bond UT/);
  assert.match(executeExplainBookingTerm({ term: "constructor" }).content, /Not a term/);
});
