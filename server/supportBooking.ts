/**
 * The booking module (BIA 3.0, package 3.1): what went wrong on the booking
 * form, and what its terms mean, in the form's own words.
 *
 *   explain_booking_error  a booking or payment error, from the error catalog
 *   explain_booking_term   DOX, SPX, Commercial, CSB V, declared value,
 *                          currency, unit rate, IGST (shared/bookingTerms.ts)
 *
 * Both only explain: nothing here reads or writes a booking. The screen the
 * customer is on (step, destination, product type) already reaches the
 * prompt through the SCREEN block; these tools answer when they quote a
 * message or ask about a word.
 */

import type { BiaTool, SupportChatContext, ToolOutcome } from "./supportTypes.js";
import { BOOKING_TERMS, BOOKING_TERM_NAMES, isBookingTerm } from "../shared/bookingTerms.js";
import { ERROR_CATALOG, explainError, type ErrorCode } from "../shared/errorCatalog.js";

/** The catalogued errors a booking can hit: the form's own, and paying for it. */
export const BOOKING_ERROR_CODES = (Object.keys(ERROR_CATALOG) as ErrorCode[]).filter(
  (code) => ERROR_CATALOG[code].area === "booking" || ERROR_CATALOG[code].area === "payment"
);

const BOOKING_CODE_SET: ReadonlySet<string> = new Set(BOOKING_ERROR_CODES);

const HOW_TO_SAY = "Explain it in two or three sentences, in these words, from their side; don't add causes of your own and don't blame them.";

export function executeExplainBookingError(args: { code?: unknown }, context: SupportChatContext): ToolOutcome {
  // What they named, or else the error on the screen they opened BIA from.
  const named = typeof args.code === "string" && BOOKING_CODE_SET.has(args.code) ? args.code : null;
  const fromScreen = context.screen?.errorCode && BOOKING_CODE_SET.has(context.screen.errorCode) ? context.screen.errorCode : null;
  const code = named ?? fromScreen;
  const entry = code ? explainError(code) : null;
  if (!entry) {
    return {
      content:
        "Not a booking error this can explain. Ask them what the message on the booking form says, word for word, or which step they're stuck on.",
    };
  }
  const lines = [`Problem: ${entry.title}.`, `Why: ${entry.why}`, `What to do: ${entry.fix}`, HOW_TO_SAY];
  if (entry.button) lines.push(entry.button);
  return { content: lines.join("\n") };
}

export function executeExplainBookingTerm(args: { term?: unknown }): ToolOutcome {
  if (!isBookingTerm(args.term)) {
    return { content: "Not a term this can explain. Answer from the booking guidance, or ask what they'd like to know." };
  }
  const info = BOOKING_TERMS[args.term];
  return {
    content: [
      `${info.title}: ${info.body}`,
      "Say it in a sentence or two, in these words. If they're choosing between product types, say which fits what they described, and that they can ask our team if unsure.",
    ].join("\n"),
  };
}

/** How the model tells the terms apart, for the tool's `term` argument. */
const TERM_HINTS: Record<(typeof BOOKING_TERM_NAMES)[number], string> = {
  product_types: "which product type to pick for what they're sending",
  DOX: "documents only",
  SPX: "a parcel of goods",
  COMMERCIAL: "goods for sale",
  CSB_V: "Courier Shipping Bill V",
  declared_value: "the value declared for customs",
  currency: "the invoice currency",
  unit_rate: "price per item",
  IGST: "IGST or Bond UT on a CSB V shipment",
};

export const BOOKING_TOOLS: readonly BiaTool[] = [
  {
    module: "booking",
    definition: {
      type: "function",
      function: {
        name: "explain_booking_error",
        description:
          "What a booking-form or payment error means and how to fix it, in the form's own words. For when they quote or describe a message and the SCREEN block doesn't already explain it.",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              enum: [...BOOKING_ERROR_CODES],
              description: BOOKING_ERROR_CODES.map((code) => `${code}: ${ERROR_CATALOG[code].title}`).join("; "),
            },
          },
          required: ["code"],
        },
      },
    },
    run: async (args, context) => executeExplainBookingError(args, context),
  },
  {
    module: "booking",
    definition: {
      type: "function",
      function: {
        name: "explain_booking_term",
        description:
          "What a term on the booking form means: a product type, declared value, currency, unit rate or IGST. For \"which product type do I pick\", use product_types.",
        parameters: {
          type: "object",
          properties: {
            term: {
              type: "string",
              enum: [...BOOKING_TERM_NAMES],
              description: BOOKING_TERM_NAMES.map((name) => `${name}: ${TERM_HINTS[name]}`).join("; "),
            },
          },
          required: ["term"],
        },
      },
    },
    run: async (args) => executeExplainBookingTerm(args),
  },
];
