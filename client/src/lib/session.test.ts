import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUnauthorized } from "./session.js";

// Only the answers that don't sign anyone out: the expiry path itself reloads
// the page, which needs a browser.
test("a guest's refused identity upload is an answer, not an expired session", () => {
  assert.equal(checkUnauthorized("/api/kyc/upload", 401), false);
  assert.equal(checkUnauthorized("/api/guest/profile", 401), false);
  assert.equal(checkUnauthorized("/api/payments/create", 401), false);
});

test("anything but a 401 is never an expiry", () => {
  assert.equal(checkUnauthorized("/api/account/documents", 422), false);
  assert.equal(checkUnauthorized("/api/orders", 200), false);
});
