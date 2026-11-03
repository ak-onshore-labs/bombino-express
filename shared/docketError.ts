/**
 * Why ITD refused an airway bill, said for the person reading it.
 *
 * A refused docket is recorded as ITD's raw answer (server/ordersDb.ts
 * §recordBookingDocketError), e.g.
 *
 *   ITD create shipment error: 500 Internal Server Error — {"success":false,
 *   "errors":["Freight amount is 0"],"Response Code":500}
 *
 * Ops needs ITD's own reason and what usually causes it; the customer needs
 * to know their booking is safe and whether anything is theirs to check.
 */

export interface DocketFailure {
  /** ITD's reason, as ITD put it, without the HTTP wrapping. */
  reason: string;
  /** What usually causes it and what to do, for ops. */
  opsHint: string;
  /**
   * What the customer is told, or null for nothing at all.
   *
   * Only when there is something for them to do. A refused or late docket is
   * ours to sort out: the customer's booking is safe either way, the AWB
   * simply reads "Not issued yet" like every order before dispatch, and
   * telling them the courier refused it only worries them about something
   * they cannot fix.
   */
  customerNote: string | null;
}


/** The `errors` ITD listed, or its message, from the raw text we stored. */
export function itdReason(raw: string): string {
  const brace = raw.indexOf("{");
  if (brace >= 0) {
    try {
      const body = JSON.parse(raw.slice(brace)) as { errors?: unknown; message?: unknown };
      if (Array.isArray(body.errors) && body.errors.length > 0) return body.errors.map(String).join("; ");
      if (typeof body.message === "string" && body.message.trim()) return body.message.trim();
    } catch {
      // Not JSON after all: fall through to the text itself.
    }
  }
  return raw.replace(/^ITD create shipment error:\s*\d+[^—]*—\s*/i, "").trim() || raw.trim();
}

export function explainDocketError(
  raw: string,
  given?: string | null,
  /** Who acts next, as server/docketFiling.ts recorded it (shared/docketRules.ts). */
  retry?: string | null
): DocketFailure {
  const reason = itdReason(raw);
  // The stage, when the caller has it; otherwise read off the two messages
  // written before a filing ever reaches ITD.
  const stage =
    given ??
    (/sign in to (the customer's )?ITD/i.test(raw) ? "token" : /identity document/i.test(raw) ? "kyc" : null);
  const gaveUp = /stopped retrying/i.test(raw);

  if (stage === "precheck") {
    return {
      reason,
      opsHint: "Nothing was sent to ITD. Correct the details listed with the customer, then press Retry AWB.",
      customerNote: null,
    };
  }
  if (stage === "unpriced" || /freight amount is 0/i.test(reason)) {
    return {
      reason: stage === "unpriced" ? reason : `ITD couldn't price this shipment (${reason})`,
      opsHint:
        "Usually the receiver's address or the product type. A US address needs a 5-digit ZIP and a US state, and Documents (DOX) is paper only: books, clothes and other goods are Package (SPX). Correct it with the customer, then press Retry AWB.",
      customerNote: null,
    };
  }
  if (stage === "token") {
    return {
      reason,
      opsHint: gaveUp || retry === "ops"
        ? "The customer's ITD login keeps failing, usually because their ITD password changed. Update it under Customers, then press Retry AWB."
        : "Retrying automatically every 10 minutes. If it keeps failing, the customer's ITD password has probably changed.",
      customerNote: null,
    };
  }
  if (stage === "kyc") {
    return {
      reason,
      opsHint: "Filed automatically as soon as the customer adds an ID document. Ask them to add one in My Profile.",
      customerNote: "Add your ID document in My Profile so we can ship this order.",
    };
  }
  if (stage === "disabled") {
    return { reason, opsHint: "Use the production console to file it.", customerNote: null };
  }
  if (retry === "check_itd" || stage === "timeout" || stage === "persist") {
    return {
      reason,
      opsHint:
        "ITD may already have filed this docket. Look for it in the customer's ITD account first. If it's there, don't retry: enter that AWB at Settled with Enter AWB from ITD portal. If it isn't, press Checked ITD portal: retry AWB.",
      customerNote: null,
    };
  }
  if (retry === "auto") {
    return {
      reason,
      opsHint: "Couldn't reach ITD; nothing was filed. Retrying automatically every 10 minutes.",
      customerNote: null,
    };
  }
  return {
    reason,
    opsHint: "ITD refused the docket for the reason above. Correct the order to match, then press Retry AWB.",
    customerNote: null,
  };
}
