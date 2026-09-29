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
  /** What the customer is told. */
  customerNote: string;
}

const DEFAULT_CUSTOMER_NOTE =
  "Your booking is confirmed. We couldn't raise the airway bill just now; our team has been told and will issue it before your parcel ships.";

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

export function explainDocketError(raw: string, given?: string | null): DocketFailure {
  const reason = itdReason(raw);
  // The stage, when the caller has it; otherwise read off the two messages
  // server/docketAtBooking.ts writes before it ever reaches ITD.
  const stage =
    given ??
    (/sign in to ITD/i.test(raw) ? "token" : /identity document/i.test(raw) ? "kyc" : null);

  if (/freight amount is 0/i.test(reason)) {
    return {
      reason: `ITD couldn't price this shipment (${reason})`,
      opsHint:
        "Usually the receiver's address or the product type. A US address needs a 5-digit ZIP and a US state, and Documents (DOX) is paper only: books, clothes and other goods are Package (SPX). Correct it with the customer, then file the docket again.",
      customerNote:
        "Your booking is confirmed, but the courier couldn't price it as booked. Our team will check the receiver's address and what's inside with you before it ships.",
    };
  }
  if (stage === "token") {
    return {
      reason,
      opsHint:
        "The customer's ITD login didn't work, often because their ITD password changed. Update it under Customers, then file the docket again.",
      customerNote: DEFAULT_CUSTOMER_NOTE,
    };
  }
  if (stage === "kyc") {
    return {
      reason,
      opsHint: "ITD needs an identity document with the docket. Ask the customer to add one, then file the docket again.",
      customerNote:
        "Your booking is confirmed. We need your identity document before the airway bill can be issued: add it from My Profile.",
    };
  }
  if (/timed out|ECONN|fetch failed|50[234]/i.test(raw)) {
    return {
      reason,
      opsHint: "ITD didn't answer in time. Nothing was filed, so filing the docket again is safe.",
      customerNote: DEFAULT_CUSTOMER_NOTE,
    };
  }
  return {
    reason,
    opsHint: "ITD refused the docket for the reason above. Correct the order to match, then file the docket again.",
    customerNote: DEFAULT_CUSTOMER_NOTE,
  };
}
