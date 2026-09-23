import { test } from "node:test";
import assert from "node:assert/strict";

import { itdLinkFailure } from "./itdLinkError.js";

test("an HTTP refusal from ITD reads as a wrong email or password", () => {
  const failure = itdLinkFailure("ITD auth failed: 401 Unauthorized");
  assert.equal(failure.status, 401);
  assert.equal(failure.code, "ITD_LOGIN_FAILED");
  assert.doesNotMatch(failure.message, /ITD|401|Unauthorized/);
});

test("ITD's own error list reads as a wrong email or password", () => {
  assert.equal(itdLinkFailure("Invalid credentials").code, "ITD_LOGIN_FAILED");
  assert.equal(itdLinkFailure("User not found, Password mismatch").code, "ITD_LOGIN_FAILED");
});

test("a timeout, network failure or ITD 5xx reads as try again later", () => {
  for (const raw of [
    "ITD loginUser (link) timed out after 15000ms",
    "fetch failed",
    "connect ECONNREFUSED 1.2.3.4:443",
    "ITD auth failed: 503 Service Unavailable",
  ]) {
    const failure = itdLinkFailure(raw);
    assert.equal(failure.status, 502, raw);
    assert.equal(failure.code, "ITD_UNAVAILABLE", raw);
  }
});
