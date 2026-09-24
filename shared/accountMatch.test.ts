import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_CHOICES,
  accountChecklist,
  isAccountChoice,
  matchAccount,
  signupPathFor,
  type AccountAnswers,
  type AccountChoice,
} from "./accountMatch.js";
import { COMPANY_CATEGORIES, requiredDocuments, requiredExtraFields } from "./accountSpec.js";

const choiceOf = (answers: AccountAnswers): AccountChoice | "ask" => {
  const m = matchAccount(answers);
  return m.kind === "match" ? m.choice : "ask";
};

test("whether it's for a business has to be asked, unless the answers already say so", () => {
  assert.equal(choiceOf({}), "ask");
  assert.equal(choiceOf({ sellsOnline: false }), "ask");
  assert.equal(choiceOf({ sellsOnline: true }), "ecommerce");
  assert.equal(choiceOf({ isCourier: true }), "co_courier");
  assert.equal(choiceOf({ stockHeldByBombino: true }), "fbb");
});

test("not a business is personal, whatever else was said", () => {
  for (const isCourier of [true, false, undefined]) {
    for (const stockHeldByBombino of [true, false, undefined]) {
      for (const sellsOnline of [true, false, undefined]) {
        assert.equal(choiceOf({ forBusiness: false, isCourier, stockHeldByBombino, sellsOnline }), "personal");
      }
    }
  }
});

test("every business path, in order: courier, then FBB, then e-commerce, else corporate", () => {
  const cases: [AccountAnswers, AccountChoice][] = [
    [{ forBusiness: true }, "corporate"],
    [{ forBusiness: true, isCourier: false, stockHeldByBombino: false, sellsOnline: false }, "corporate"],
    [{ forBusiness: true, sellsOnline: true }, "ecommerce"],
    [{ forBusiness: true, stockHeldByBombino: true }, "fbb"],
    [{ forBusiness: true, stockHeldByBombino: true, sellsOnline: true }, "fbb"],
    [{ forBusiness: true, isCourier: true }, "co_courier"],
    [{ forBusiness: true, isCourier: true, sellsOnline: true }, "co_courier"],
    [{ forBusiness: true, isCourier: true, stockHeldByBombino: true }, "co_courier"],
    [{ forBusiness: true, isCourier: true, stockHeldByBombino: true, sellsOnline: true }, "co_courier"],
  ];
  for (const [answers, expected] of cases) {
    assert.equal(choiceOf(answers), expected, JSON.stringify(answers));
  }
});

test("every category's checklist equals requiredDocuments plus requiredExtraFields", () => {
  const personal = accountChecklist("personal");
  assert.deepEqual(personal.documents.map((d) => d.slot), [...requiredDocuments("personal")]);
  assert.deepEqual(personal.fields, []);
  for (const category of COMPANY_CATEGORIES) {
    const list = accountChecklist(category);
    assert.deepEqual(list.documents.map((d) => d.slot), [...requiredDocuments("company", category)], category);
    assert.deepEqual(list.fields.map((f) => f.field), [...requiredExtraFields(category)], category);
    assert.ok(list.documents.every((d) => d.label && d.hint), category);
  }
});

test("each choice has a signup door that preselects it", () => {
  assert.equal(signupPathFor("personal"), "/signup?type=personal");
  assert.equal(signupPathFor("ecommerce"), "/signup?type=company&category=ecommerce");
  assert.deepEqual(ACCOUNT_CHOICES.filter(isAccountChoice), [...ACCOUNT_CHOICES]);
  assert.equal(isAccountChoice("admin"), false);
});
