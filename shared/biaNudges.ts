/**
 * BIA's nudges (BIA 3.0, package 5.1): the few times BIA speaks first, through
 * the bell, when something of the customer's own has stalled. One list for both
 * ends: the server's sweep (server/supportNudges.ts) sends them, the bell opens
 * BIA about one (client/src/lib/notificationLink.ts), and Profile and the guest
 * profile switch each kind off.
 *
 * Every nudge is about the customer's own order, document or signup. None is
 * marketing: nothing here sells, announces or asks for a review.
 */

export const NUDGE_KINDS = ["document_failed", "amount_changed", "pickup_tomorrow", "signup_stuck", "guest_account"] as const;

export type NudgeKind = (typeof NUDGE_KINDS)[number];

export function isNudgeKind(value: unknown): value is NudgeKind {
  return (NUDGE_KINDS as readonly unknown[]).includes(value);
}

interface NudgeSpec {
  /** The switch on Profile. */
  label: string;
  /** Under the switch: what it's about. */
  hint: string;
  /** Who can get it: an account, a guest, or both. */
  audience: "account" | "guest" | "both";
}

export const NUDGE_SPECS: Record<NudgeKind, NudgeSpec> = {
  document_failed: {
    label: "A document needs replacing",
    hint: "When a document you uploaded couldn't be checked.",
    audience: "both",
  },
  amount_changed: {
    label: "The final amount changed",
    hint: "When your parcel's weighed price differs from the estimate.",
    audience: "both",
  },
  pickup_tomorrow: {
    label: "Pickup tomorrow",
    hint: "The day before a doorstep pickup.",
    audience: "both",
  },
  signup_stuck: {
    label: "An unfinished signup",
    hint: "When an account you started opening is waiting on you.",
    audience: "guest",
  },
  guest_account: {
    label: "Your shipments in one place",
    hint: "Once, after a few guest bookings: how an account keeps them together.",
    audience: "guest",
  },
};

/** The kinds a customer of this sort can get, in the order Profile lists them. */
export function nudgeKindsFor(owner: "account" | "guest"): NudgeKind[] {
  return NUDGE_KINDS.filter((k) => NUDGE_SPECS[k].audience === "both" || NUDGE_SPECS[k].audience === owner);
}

/**
 * What BIA is asked for the customer when they tap a nudge. Built here from
 * the kind and the order, never from text stored with the notification.
 */
export function nudgeSeed(kind: NudgeKind, orderNo: string | null): string {
  switch (kind) {
    case "document_failed":
      return "Which of my documents needs replacing, and why?";
    case "amount_changed":
      return orderNo ? `Why did the amount change on ${orderNo}?` : "Why did my amount change?";
    case "pickup_tomorrow":
      return orderNo ? `What do I need for tomorrow's pickup of ${orderNo}?` : "What do I need for tomorrow's pickup?";
    case "signup_stuck":
      return "Where does my signup stand?";
    case "guest_account":
      return "Should I open an account or keep booking as a guest?";
  }
}

/** A bell row's `data` for a nudge. */
export interface NudgeNotificationData {
  kind: "bia_nudge";
  nudge: NudgeKind;
  orderNo: string | null;
}
