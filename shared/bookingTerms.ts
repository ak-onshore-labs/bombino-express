/**
 * What the booking form's terms mean, in one place: the product-type info
 * sheet in CreateShipment and BIA's explain_booking_term say the same words.
 *
 * Copy rules as the error catalog's: plain, from the customer's side. Nothing
 * here is tax advice; where the answer depends on the customer's own filings,
 * the text says who can tell them.
 */

/** The product types the booking form offers, by the value its select carries. */
export const PRODUCT_TYPES = ["DOX", "SPX", "COMMERCIAL", "CSB V"] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

export function isProductType(value: unknown): value is ProductType {
  return typeof value === "string" && (PRODUCT_TYPES as readonly string[]).includes(value);
}

export interface TermInfo {
  title: string;
  body: string;
}

/**
 * What each product type means, for the form's info sheet. Keyed by the value
 * the select carries, so the sheet explains exactly the options on offer — a
 * personal customer reading about CSB V is reading about a filing they can't
 * make.
 */
export const PRODUCT_TYPE_INFO: Record<ProductType, TermInfo> = {
  DOX: {
    title: "Documents (DOX)",
    body: "Standard industry code for shipments containing only paper — no commercial value, no duties.",
  },
  SPX: {
    title: "Package (SPX)",
    body: "Small Parcel Express — usually containing physical goods that aren't just paper.",
  },
  COMMERCIAL: {
    title: "Commercial",
    body: "Goods meant for sale or trade. Requires a formal invoice and duty assessment.",
  },
  "CSB V": {
    title: "CSB V",
    body: "Courier Shipping Bill V — a simplified export process for low-value goods usually under ₹5,00,000 sent via courier.",
  },
};

/**
 * What each step of the booking form asks for (client/src/pages/CreateShipment.tsx),
 * by the step names in shared/biaScreen.ts. BIA answers "what do I do here"
 * from this rather than guessing at fields. Keep it in step with the form.
 */
export const BOOKING_STEP_GUIDE: Record<string, string> = {
  sender:
    "Their own details: full name, company (optional), email, phone and address with pincode, city and state. Then collection: a doorstep pickup (with a pickup date) or dropping the parcel at a Bombino counter; the address they give is theirs either way. If no identity document is on file yet, they add one here; a guest also accepts the shipping terms here.",
  receiver: "The destination country, then the receiver's name, address, postal code and contact details.",
  package:
    "Weight and number of pieces, packaging, and the shipment's declared value with its currency. Continuing shows the services and prices for this parcel to choose from.",
  invoice:
    "The chosen service, the product type (with an HS code for CSB V), and the invoice item: a description, quantity, unit weight and unit rate. Then review and pay.",
  payment: "Review and pay: check the summary, choose how to pay, and accept the shipping terms if asked.",
};

/** Every term BIA can explain, by the name its tool takes. */
export const BOOKING_TERMS = {
  product_types: {
    title: "Product type",
    body: "Choose by what's inside. Documents (DOX) is paper only. Package (SPX) is any other goods, gifts and personal things included. Commercial is goods you're selling, with a formal invoice. CSB V is for low-value exports a business files under that shipping bill.",
  },
  DOX: PRODUCT_TYPE_INFO.DOX,
  SPX: PRODUCT_TYPE_INFO.SPX,
  COMMERCIAL: PRODUCT_TYPE_INFO.COMMERCIAL,
  CSB_V: PRODUCT_TYPE_INFO["CSB V"],
  declared_value: {
    title: "Declared value",
    body: "What the contents are worth, as you declare them for customs on the package step. It's for customs, not the price of shipping, and it should match what's on your invoice.",
  },
  currency: {
    title: "Currency",
    body: "The currency your declared value and invoice are in. The form offers rupees, and the destination's own currency where it has one.",
  },
  unit_rate: {
    title: "Unit rate",
    body: "The price of one item on the invoice, in the invoice's currency. Quantity times unit rate is the invoice total.",
  },
  IGST: {
    title: "IGST",
    body: "Integrated GST. On a CSB V shipment the form asks how the export is covered: IGST, where you enter the IGST amount paid, or Bond UT, where you ship under your LUT and enter its number and dates instead. Which applies depends on your own GST filings; your accountant can tell you.",
  },
} as const satisfies Record<string, TermInfo>;

export type BookingTerm = keyof typeof BOOKING_TERMS;

export const BOOKING_TERM_NAMES = Object.keys(BOOKING_TERMS) as BookingTerm[];

export function isBookingTerm(value: unknown): value is BookingTerm {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BOOKING_TERMS, value);
}
