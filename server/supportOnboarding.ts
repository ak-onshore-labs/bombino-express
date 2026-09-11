/**
 * BIA's onboarding tools (BIA 3.0, package 2.1): which account someone needs,
 * and what the words on the signup form mean.
 *
 * The recommendation is a lookup, not a judgement. The model only reports the
 * customer's yes/no answers; shared/accountMatch.ts decides, and the checklist
 * is read from shared/accountSpec.ts — the same file the signup form and its
 * server validator read — so what BIA lists is what signup will ask for.
 *
 * Executors never throw; each returns text for the model.
 */

import { guidance } from "./supportContent.js";
import type { BiaTool, SupportChatContext, ToolOutcome } from "./supportTypes.js";
import { ownerOf } from "./supportOrders.js";
import { accountChecklist, matchAccount, type AccountAnswers } from "../shared/accountMatch.js";
import type { ChecklistCard } from "../shared/biaCards.js";

// ─── recommend_account ───────────────────────────────────────────────────────

/** A yes/no the model passed, or undefined when it passed nothing usable. */
function yesNo(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "yes") return true;
  if (value === "false" || value === "no") return false;
  return undefined;
}

export function executeRecommendAccount(args: Record<string, unknown>, context: SupportChatContext): ToolOutcome {
  const answers: AccountAnswers = {
    forBusiness: yesNo(args.for_business),
    isCourier: yesNo(args.is_courier),
    stockHeldByBombino: yesNo(args.stock_held_by_bombino),
    sellsOnline: yesNo(args.sells_online),
  };
  const match = matchAccount(answers);
  if (match.kind === "ask") {
    return {
      content:
        "Ask one question first: is the account for themselves, or for a business? Then call recommend_account again with the answer.",
    };
  }

  const list = accountChecklist(match.choice);
  const isAccount = ownerOf(context)?.kind === "account";
  const card: ChecklistCard = {
    kind: "checklist",
    choice: list.choice,
    title: `${list.label} account`,
    documents: list.documents.map(({ label, hint }) => ({ label, hint })),
    fields: list.fields.map((f) => f.label),
  };

  const lines = [
    `Recommended: a ${list.label} account.`,
    `Documents signup asks for: ${list.documents.map((d) => d.label).join(", ")}.`,
  ];
  if (list.fields.length > 0) lines.push(`Also typed in at signup: ${list.fields.map((f) => f.label).join(", ")}.`);
  lines.push("The full list is shown in a card under your reply: name the account type and say signup asks for these, without listing every document again.");
  if (match.choice === "personal") {
    lines.push(`If they only send a parcel now and then, they can book as a guest instead: ${guidance.guestOrAccount}`);
  } else {
    lines.push(
      "Other company accounts, if this doesn't fit: Corporate (a registered business), Co-Courier (a courier company), E-commerce (an online seller exporting under LUT), FBB (Bombino holds and ships the stock)."
    );
  }
  if (isAccount) {
    lines.push("They are already signed in to an account, so there is no signup button. To change their account type, they contact our team.");
  } else {
    lines.push(`TAP_SIGNUP:${match.choice}`);
  }
  return { content: lines.join("\n"), cards: [card] };
}

// ─── explain_term ────────────────────────────────────────────────────────────

/**
 * The words on the company signup form. Plain and general on purpose: what
 * the thing is, where it comes from, and where to find it. Anything specific
 * to someone's business is for their CA or our team, not BIA.
 */
export const ONBOARDING_TERMS = {
  gstin:
    "GSTIN: the 15-character GST number of a registered business. It's printed on the GST registration certificate and on the GST portal. Company accounts give it at signup, and it's checked against the company name.",
  iec:
    "IEC (Importer-Exporter Code): a 10-character code from the DGFT that a business needs to export goods commercially. The IEC certificate can be downloaded from the DGFT website.",
  lut:
    "LUT (Letter of Undertaking): filed each financial year on the GST portal, it lets a registered exporter ship without paying IGST upfront. E-commerce accounts give the LUT number from its acknowledgement.",
  ad_code:
    "AD code (Authorised Dealer code): the code of the bank branch that handles the business's foreign-exchange payments. The bank issues it on a letter; export payments come back through that branch.",
  iec_branch_code:
    "IEC branch code: the number given to each address listed on an IEC. It's shown against the address on the IEC details on the DGFT website. If unsure, their CA or customs broker will know it.",
  authorization_letter:
    "Authorization letter: at Bombino signup, this is the signed copy of the contract with Bombino, which authorises us to ship for the company. It's signed by someone allowed to sign for the business.",
  pan:
    "PAN: the 10-character tax number from the Income Tax Department, like ABCDE1234F. A company account uses the company's PAN.",
} as const;

export type OnboardingTerm = keyof typeof ONBOARDING_TERMS;

const TERM_ALIASES: Record<string, OnboardingTerm> = {
  gst: "gstin",
  gstin: "gstin",
  gstnumber: "gstin",
  iec: "iec",
  iecode: "iec",
  importerexportercode: "iec",
  lut: "lut",
  letterofundertaking: "lut",
  adcode: "ad_code",
  ad: "ad_code",
  authoriseddealercode: "ad_code",
  authorizeddealercode: "ad_code",
  bankadcode: "ad_code",
  iecbranchcode: "iec_branch_code",
  branchcode: "iec_branch_code",
  authorizationletter: "authorization_letter",
  authorisationletter: "authorization_letter",
  authletter: "authorization_letter",
  pan: "pan",
  pancard: "pan",
};

export function termFor(raw: string): OnboardingTerm | null {
  const key = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  return TERM_ALIASES[key] ?? null;
}

export function executeExplainTerm(args: Record<string, unknown>): ToolOutcome {
  const term = termFor(typeof args.term === "string" ? args.term : "");
  if (!term) {
    return {
      content:
        "That term isn't one BIA has an explanation for. Say you're not sure, and suggest they ask our team or their CA.\nTAP_CONTACT_US",
    };
  }
  return { content: ONBOARDING_TERMS[term] };
}

// ─── Registration ────────────────────────────────────────────────────────────

const yesNoParam = (description: string): { type: "boolean"; description: string } => ({ type: "boolean", description });

export const ONBOARDING_TOOLS: readonly BiaTool[] = [
  {
    module: "onboarding",
    definition: {
      type: "function",
      function: {
        name: "recommend_account",
        description:
          "Which Bombino account someone needs (or whether they can book as a guest), and what signup will ask for. Pass what the customer has said; leave out anything they haven't.",
        parameters: {
          type: "object",
          properties: {
            for_business: yesNoParam("True if the account is for a business or company, false if for themselves."),
            is_courier: yesNoParam("True if they are a courier company handing parcels over to Bombino."),
            stock_held_by_bombino: yesNoParam("True if they want Bombino to hold their stock and ship orders from it."),
            sells_online: yesNoParam("True if they sell online (Etsy, Amazon, their own website) and ship those orders abroad."),
          },
        },
      },
    },
    run: async (args, context) => executeRecommendAccount(args, context),
  },
  {
    module: "onboarding",
    definition: {
      type: "function",
      function: {
        name: "explain_term",
        description: "What a word on the signup form means: GSTIN, IEC, LUT, AD code, IEC branch code, authorization letter or PAN.",
        parameters: {
          type: "object",
          properties: {
            term: { type: "string", description: "The term, e.g. LUT" },
          },
          required: ["term"],
        },
      },
    },
    run: async (args) => executeExplainTerm(args),
  },
];
