import { test } from "node:test";
import assert from "node:assert/strict";

import { isDocumentsContent } from "./bookingTerms.js";

test("paper contents read as documents", () => {
  for (const c of ["DOCUMENTS", "Legal papers", "university transcripts", "Letter", ""]) {
    assert.equal(isDocumentsContent(c), true, c);
  }
});

test("goods do not read as documents", () => {
  for (const c of ["BOOKS", "CLOTHES", "ELECTRONICS", "spices", "handmade bags"]) {
    assert.equal(isDocumentsContent(c), false, c);
  }
});
