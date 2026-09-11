/**
 * Cards: the structured half of a BIA reply, drawn under the message.
 *
 * A card is built by a tool from data the tool has already checked — an order
 * card only ever comes out of a lookup that proved the caller owns the order.
 * The model never writes one and cannot change one. Every value is something
 * the customer may see: customer status labels (never weighed / settled /
 * ready_for_docket), no ids, no codes.
 *
 * More kinds arrive with later packages: checklist (2.1), docStatus (2.2),
 * docUpload (2.5), hsn (3.2), draft (3.3), case (4.1). Add the kind here and
 * its renderer in client/src/components/bia/BiaCards.tsx together.
 */

/** Same names as the app's status badges (client/src/lib/awbStatus.ts). */
export type BiaCardTone = "gray" | "blue" | "amber" | "green" | "red" | "orange";

export interface OrderCard {
  kind: "order";
  /** Null for a shipment booked before orders existed; it has only an AWB. */
  orderNo: string | null;
  awb: string | null;
  destination: string;
  /** The customer's label, as the order screen shows it. */
  status: string;
  tone: BiaCardTone;
  /** "3 Sep" */
  bookedOn: string | null;
  /** Where tapping it goes, inside the app. Null when there is nowhere to go. */
  href: string | null;
}

export interface PickupCard {
  kind: "pickup";
  pincode: string;
  /** "Andheri, Mumbai" or "Bangalore, Karnataka"; null when unknown. */
  place: string | null;
  available: boolean;
  /** "7 PM" */
  cutoff: string | null;
  /** "today", "tomorrow", "Wed, 3 Sep" */
  earliest: string | null;
  /** Outside the rider's normal round: an extra charge may apply. */
  outOfCity: boolean;
  /** Nearest drop-off counters, when pickup isn't available. */
  counters: { city: string; address: string }[];
  /** The state the Locations page should open on. */
  state: string | null;
}

export interface RateCard {
  kind: "rate";
  destination: string;
  weightKg: number;
  /** Cheapest first. */
  services: { name: string; amount: number }[];
  /** Whether this route can be booked in the app. */
  bookable: boolean;
}

export type BiaCard = OrderCard | PickupCard | RateCard;

/** At most this many cards under one reply. */
export const MAX_BIA_CARDS = 5;

/**
 * An order status as a badge colour — the same mapping as the order list
 * (client/src/lib/orderStatus.ts). Hub statuses share one colour, just as
 * they share one label.
 */
export function toneForOrderStatus(status: string, opts: { overdue?: boolean } = {}): BiaCardTone {
  if (opts.overdue) return "orange";
  switch (status) {
    case "agent_accepted":
    case "out_for_pickup":
    case "picked_up":
      return "blue";
    case "received_at_hub":
    case "weighed":
    case "settled":
    case "ready_for_docket":
      return "amber";
    case "dispatched":
      return "green";
    case "cancelled":
      return "red";
    default:
      return "gray";
  }
}

/** A carrier's free-text status (legacy ITD shipments) as a badge colour. */
export function toneForCarrierStatus(status: string): BiaCardTone {
  if (/deliver/i.test(status)) return "green";
  if (/cancel|return|rto|lost|damag/i.test(status)) return "red";
  if (/hold|exception|delay/i.test(status)) return "orange";
  return "blue";
}

/** Links a card may carry: an order, a tracked shipment, or the shipments list. */
const HREF_RE = /^\/(order\/BOM-\d{6,9}|shipment\/[A-Za-z0-9-]{4,32}|orders)$/;

const TONES: readonly string[] = ["gray", "blue", "amber", "green", "red", "orange"];

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/**
 * Whether a value is a well-formed card. The client runs every card through
 * this before drawing it, so a stale or tampered transcript can't produce a
 * link that leaves the app.
 */
export function isBiaCard(value: unknown): value is BiaCard {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  switch (c.kind) {
    case "order":
      return (
        isStrOrNull(c.orderNo) &&
        isStrOrNull(c.awb) &&
        isStr(c.destination) &&
        isStr(c.status) &&
        isStr(c.tone) &&
        TONES.includes(c.tone) &&
        isStrOrNull(c.bookedOn) &&
        (c.href === null || (isStr(c.href) && HREF_RE.test(c.href)))
      );
    case "pickup":
      return (
        isStr(c.pincode) &&
        isStrOrNull(c.place) &&
        typeof c.available === "boolean" &&
        isStrOrNull(c.cutoff) &&
        isStrOrNull(c.earliest) &&
        typeof c.outOfCity === "boolean" &&
        Array.isArray(c.counters) &&
        c.counters.every((b) => !!b && typeof b === "object" && isStr((b as { city?: unknown }).city) && isStr((b as { address?: unknown }).address)) &&
        isStrOrNull(c.state)
      );
    case "rate":
      return (
        isStr(c.destination) &&
        typeof c.weightKg === "number" &&
        Array.isArray(c.services) &&
        c.services.every(
          (s) => !!s && typeof s === "object" && isStr((s as { name?: unknown }).name) && typeof (s as { amount?: unknown }).amount === "number"
        ) &&
        typeof c.bookable === "boolean"
      );
    default:
      return false;
  }
}

/** The cards in an unknown value that are well-formed, capped. */
export function parseBiaCards(value: unknown): BiaCard[] {
  return Array.isArray(value) ? value.filter(isBiaCard).slice(0, MAX_BIA_CARDS) : [];
}
