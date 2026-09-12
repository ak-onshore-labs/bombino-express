import { test } from "node:test";
import assert from "node:assert/strict";
import { ASKS_FOR_A_PERSON } from "./supportAgent.js";

test("asking for a person is recognised, so the reply always carries a way to reach one", () => {
  for (const text of [
    "I want to speak to someone at Bombino.",
    "can i talk to a real person",
    "Let me chat with your team",
    "customer care number?",
    "please call me",
    "I need to talk to support",
  ]) {
    assert.ok(ASKS_FOR_A_PERSON.test(text), text);
  }
  for (const text of ["track 123456789012", "Who is someone who can pick up my parcel?", "talk me through the booking"]) {
    assert.ok(!ASKS_FOR_A_PERSON.test(text), text);
  }
});
