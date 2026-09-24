import { test } from "node:test";
import assert from "node:assert/strict";
import { ASKS_FOR_A_PERSON, ASKS_TO_UPLOAD } from "./supportAgent.js";

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

test("asking to upload a document in the chat is recognised, and other questions aren't", () => {
  for (const text of [
    "Can I upload a clearer photo of my PAN card right here?",
    "I'd like to replace my ID document here in the chat.",
    "let me send a new aadhaar photo",
    "can I reupload my GST certificate",
  ]) {
    assert.ok(ASKS_TO_UPLOAD.test(text), text);
  }
  for (const text of ["Where is my parcel?", "What documents do I need to sign up?", "How much to send 2 kg to London?"]) {
    assert.ok(!ASKS_TO_UPLOAD.test(text), text);
  }
});
