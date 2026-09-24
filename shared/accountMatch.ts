/**
 * "Which account do I need?" — answered from a fixed table, never by the
 * model's judgement. BIA's recommend_account tool (server/supportOnboarding.ts)
 * gathers four yes/no answers from the conversation and this file turns them
 * into one of the five categories in shared/accountSpec.ts; the checklist it
 * shows comes from that same file, so it is exactly what signup will ask for.
 *
 *   not a business                    → personal
 *   a courier company                 → co_courier
 *   Bombino holds and ships its stock → fbb
 *   sells online, exports under LUT   → ecommerce
 *   any other business                → corporate
 *
 * First match wins, in that order. A courier that also sells online is still
 * handing consignments over as a courier; a seller whose stock Bombino holds
 * is fulfilled by Bombino whichever marketplace the orders come from.
 */

import {
  COMPANY_CATEGORY_SPECS,
  DOC_SLOT_SPECS,
  EXTRA_FIELD_SPECS,
  requiredDocuments,
  requiredExtraFields,
  type CompanyCategory,
  type DocSlot,
  type ExtraField,
} from "./accountSpec.js";

export type AccountChoice = "personal" | CompanyCategory;

export const ACCOUNT_CHOICES: readonly AccountChoice[] = ["personal", "corporate", "co_courier", "ecommerce", "fbb"];

export function isAccountChoice(value: unknown): value is AccountChoice {
  return typeof value === "string" && (ACCOUNT_CHOICES as readonly string[]).includes(value);
}

/**
 * What the customer has told us. An answer they haven't given is undefined,
 * and reads as "no" for the last three: most businesses are none of them.
 */
export interface AccountAnswers {
  forBusiness?: boolean;
  isCourier?: boolean;
  stockHeldByBombino?: boolean;
  sellsOnline?: boolean;
}

export type AccountMatch =
  | { kind: "match"; choice: AccountChoice }
  /** Whether it is for a business is the one question that can't default. */
  | { kind: "ask"; question: "forBusiness" };

export function matchAccount(answers: AccountAnswers): AccountMatch {
  // Being a courier, selling online or having stock held for you is already
  // an answer: nobody does those as a private person.
  const businessSignal = !!(answers.isCourier || answers.stockHeldByBombino || answers.sellsOnline);
  const forBusiness = answers.forBusiness ?? (businessSignal ? true : undefined);
  if (forBusiness === undefined) return { kind: "ask", question: "forBusiness" };
  if (!forBusiness) return { kind: "match", choice: "personal" };
  if (answers.isCourier) return { kind: "match", choice: "co_courier" };
  if (answers.stockHeldByBombino) return { kind: "match", choice: "fbb" };
  if (answers.sellsOnline) return { kind: "match", choice: "ecommerce" };
  return { kind: "match", choice: "corporate" };
}

/** "Personal", "E-commerce", … as the signup form labels them. */
export function accountChoiceLabel(choice: AccountChoice): string {
  return choice === "personal" ? "Personal" : COMPANY_CATEGORY_SPECS[choice].label;
}

export interface AccountChecklist {
  choice: AccountChoice;
  label: string;
  documents: { slot: DocSlot; label: string; hint: string }[];
  fields: { field: ExtraField; label: string }[];
}

/**
 * Everything signup will ask this account for beyond name, phone and email:
 * the documents, and the extra business fields. Read straight from
 * accountSpec.ts so it can't disagree with the form.
 */
export function accountChecklist(choice: AccountChoice): AccountChecklist {
  const documents = choice === "personal" ? requiredDocuments("personal") : requiredDocuments("company", choice);
  const fields = choice === "personal" ? [] : requiredExtraFields(choice);
  return {
    choice,
    label: accountChoiceLabel(choice),
    documents: documents.map((slot) => ({ slot, label: DOC_SLOT_SPECS[slot].label, hint: DOC_SLOT_SPECS[slot].hint })),
    fields: fields.map((field) => ({ field, label: EXTRA_FIELD_SPECS[field].label })),
  };
}

/**
 * Where signup starts for this choice, already on the right form. "company"
 * alone opens the company form on its default category.
 */
export function signupPathFor(choice: AccountChoice | "company"): string {
  if (choice === "personal") return "/signup?type=personal";
  if (choice === "company") return "/signup?type=company";
  return `/signup?type=company&category=${choice}`;
}
