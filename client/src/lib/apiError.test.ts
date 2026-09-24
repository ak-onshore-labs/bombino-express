import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apiErrorStatus,
  isForbiddenError,
  isNotFoundError,
  parseApiErrorCode,
  parseApiErrorMessage,
} from "./apiError.js";

// apiRequest throws `Error("<status>: <body text>")`; these are the shapes it
// produces for the routes that now send a catalogued code.
const thrown = (status: number, body: unknown): Error => new Error(`${status}: ${JSON.stringify(body)}`);

test("the code comes back from a catalogued error", () => {
  const err = thrown(409, { message: "This phone number is already registered. Please sign in instead.", code: "ACCOUNT_EXISTS" });
  assert.equal(parseApiErrorCode(err), "ACCOUNT_EXISTS");
  assert.equal(parseApiErrorMessage(err, "fallback"), "This phone number is already registered. Please sign in instead.");
});

test("a booking refinement's code comes through", () => {
  const err = thrown(400, {
    message: "Pay at pickup is only available when an agent collects the parcel",
    code: "PAY_AT_PICKUP_NEEDS_PICKUP",
  });
  assert.equal(parseApiErrorCode(err), "PAY_AT_PICKUP_NEEDS_PICKUP");
});

test("no code, a non-JSON body, or not an Error gives null", () => {
  assert.equal(parseApiErrorCode(thrown(500, { message: "Failed to save document." })), null);
  assert.equal(parseApiErrorCode(new Error("502: Bad Gateway")), null);
  assert.equal(parseApiErrorCode("nope"), null);
});

test('the status of a thrown fetch error is recoverable', () => {
  assert.equal(apiErrorStatus(new Error('403: {"message":"nope"}')), 403);
  assert.equal(apiErrorStatus(new Error('404: Not found')), 404);
  assert.equal(apiErrorStatus(new Error('boom')), null);
  assert.equal(apiErrorStatus('403: a string, not an Error'), null);
});

test('forbidden and not-found are told apart, and from everything else', () => {
  const forbidden = new Error('403: {"message":"You do not have permission"}');
  const missing = new Error('404: Customer not found');
  const broken = new Error('500: Internal Server Error');

  assert.equal(isForbiddenError(forbidden), true);
  assert.equal(isNotFoundError(forbidden), false);
  assert.equal(isNotFoundError(missing), true);
  assert.equal(isForbiddenError(broken), false);
  assert.equal(isNotFoundError(broken), false);
});
