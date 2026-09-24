import { test } from "node:test";
import assert from "node:assert/strict";
import { executeExplainTerm, executeRecommendAccount, ONBOARDING_TERMS, termFor } from "./supportOnboarding.js";
import type { SupportChatContext } from "./supportTypes.js";
import { requiredDocuments, requiredExtraFields } from "../shared/accountSpec.js";

const anon: SupportChatContext = {
  user: null,
  itdToken: null,
  dbUserId: null,
  sessionId: null,
  guestRef: null,
  guestPhone: null,
  screen: null,
};
const account: SupportChatContext = {
  ...anon,
  user: { id: "c1", email: "", fullName: "Asha Rao", code: "" },
  dbUserId: "00000000-0000-4000-8000-000000000001",
};

test("an online seller gets the e-commerce checklist and a signup button", () => {
  const outcome = executeRecommendAccount({ for_business: true, sells_online: true }, anon);
  assert.match(outcome.content, /E-commerce account/);
  assert.match(outcome.content, /^TAP_SIGNUP:ecommerce$/m);
  const card = outcome.cards?.[0];
  assert.ok(card && card.kind === "checklist");
  assert.equal(card.documents.length, requiredDocuments("company", "ecommerce").length);
  assert.equal(card.fields.length, requiredExtraFields("ecommerce").length);
});

test("not knowing whether it's a business means asking, with no card", () => {
  const outcome = executeRecommendAccount({ sells_online: "maybe", is_courier: false }, anon);
  assert.match(outcome.content, /for a business/);
  assert.equal(outcome.cards, undefined);
});

test("someone already signed in gets the answer but no signup button", () => {
  const outcome = executeRecommendAccount({ for_business: false }, account);
  assert.match(outcome.content, /Personal account/);
  assert.doesNotMatch(outcome.content, /TAP_SIGNUP/);
});

test("a personal answer offers the guest route too", () => {
  assert.match(executeRecommendAccount({ for_business: "no" }, anon).content, /guest/);
});

test("terms are found however they're written; unknown ones aren't guessed", () => {
  assert.equal(termFor("A.D. code"), "ad_code");
  assert.equal(termFor("LUT"), "lut");
  assert.equal(termFor("IEC branch code"), "iec_branch_code");
  assert.equal(executeExplainTerm({ term: "gst number" }).content, ONBOARDING_TERMS.gstin);
  assert.match(executeExplainTerm({ term: "SWIFT" }).content, /TAP_CONTACT_US/);
  assert.match(executeExplainTerm({}).content, /TAP_CONTACT_US/);
});
