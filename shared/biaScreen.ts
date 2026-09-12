/**
 * Where the customer was when they opened BIA — the screen, the step, the
 * order on it, and the error they had just seen.
 *
 * The client sends this with every chat turn. It is a hint about context, not
 * a claim of anything: an order number here does not make the order theirs
 * (the order tools still check ownership from the session), and nothing in it
 * is free text. `parseBiaScreen` keeps only values from fixed lists and fixed
 * shapes, so whatever reaches the prompt was written by us.
 */

import { accountChoiceLabel, isAccountChoice, type AccountChoice } from "./accountMatch.js";
import { PRODUCT_TYPE_INFO, isProductType, type ProductType } from "./bookingTerms.js";
import { BOOKABLE_ORIGIN } from "./corridor.js";
import { isErrorCode, type ErrorCode } from "./errorCatalog.js";

export const BIA_SURFACES = [
  "home",
  "help",
  "signup",
  "documents",
  "create",
  "order",
  "orders",
  "guest_profile",
  "track",
  "rates",
] as const;

export type BiaSurface = (typeof BIA_SURFACES)[number];

export interface BiaScreen {
  surface: BiaSurface;
  step?: string;
  orderNo?: string;
  errorCode?: ErrorCode;
  /** Signup only: the account being opened, once chosen (shared/accountMatch.ts). */
  account?: AccountChoice;
  /**
   * Booking only: the destination country, as a two-letter code. Nothing else
   * about the parcel or the people on it is ever sent: no names, addresses,
   * numbers or contents.
   */
  destination?: string;
  /** Booking only: the product type chosen, once there is one. */
  productType?: ProductType;
}

/**
 * Two-letter codes that name no country: user-assigned ranges (AA, QM–QZ,
 * XA–XZ except Kosovo's XK, ZZ) and groupings (EU, EZ, UN, QO).
 */
const NOT_A_COUNTRY = /^(AA|Q[M-Z]|QO|X[A-JL-Z]|ZZ|EU|EZ|UN)$/;

/** "US" → "United States"; null for anything that isn't a country's code. */
export function countryName(code: string): string | null {
  if (!/^[A-Z]{2}$/.test(code) || NOT_A_COUNTRY.test(code)) return null;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/** Steps a surface may report; any other step is dropped. */
export const BIA_SCREEN_STEPS: Partial<Record<BiaSurface, readonly string[]>> = {
  // client/src/pages/Signup.tsx §Step
  signup: ["account_type", "details", "otp", "documents", "preview"],
  // client/src/pages/CreateShipment.tsx §steps, plus the payment choice at the end
  create: ["sender", "receiver", "package", "invoice", "payment"],
};

/** How each surface reads in the prompt. */
export const BIA_SURFACE_LABELS: Record<BiaSurface, string> = {
  home: "the home screen",
  help: "the help screen",
  signup: "account signup",
  documents: "their account documents",
  create: "the booking form (Create Shipment)",
  order: "an order's page",
  orders: "their list of shipments",
  guest_profile: "their guest profile",
  track: "the tracking screen",
  rates: "the rates calculator",
};

const STEP_LABELS: Record<string, string> = {
  account_type: "choosing an account type",
  details: "entering their details",
  otp: "verifying their phone",
  documents: "uploading documents",
  preview: "reviewing and signing the contract",
  sender: "sender (pickup or drop-off, identity document, terms)",
  receiver: "receiver",
  package: "package (size, weight, product type)",
  invoice: "invoice (contents, quantity, value)",
  payment: "choosing how to pay",
};

export function isBiaSurface(value: unknown): value is BiaSurface {
  return typeof value === "string" && (BIA_SURFACES as readonly string[]).includes(value);
}

/**
 * The screen as sent by the client, keeping only what is valid. Null when
 * there is no recognisable surface — then BIA simply has no screen context.
 */
export function parseBiaScreen(raw: unknown): BiaScreen | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isBiaSurface(r.surface)) return null;

  const screen: BiaScreen = { surface: r.surface };
  if (typeof r.step === "string" && BIA_SCREEN_STEPS[r.surface]?.includes(r.step)) {
    screen.step = r.step;
  }
  if (typeof r.orderNo === "string") {
    const orderNo = r.orderNo.trim().toUpperCase();
    if (/^BOM-\d{6,9}$/.test(orderNo)) screen.orderNo = orderNo;
  }
  if (isErrorCode(r.errorCode)) screen.errorCode = r.errorCode;
  if (r.surface === "signup" && isAccountChoice(r.account)) screen.account = r.account;
  if (r.surface === "create") {
    // A real region other than India (where every booking starts).
    if (typeof r.destination === "string" && r.destination !== BOOKABLE_ORIGIN && countryName(r.destination)) {
      screen.destination = r.destination;
    }
    if (isProductType(r.productType)) screen.productType = r.productType;
  }
  return screen;
}

/**
 * "account signup (E-commerce account), on the uploading documents step";
 * "the booking form (Create Shipment), on the package step, sending to United
 * States as Package (SPX)"
 */
export function describeBiaScreen(screen: BiaScreen): string {
  const base = BIA_SURFACE_LABELS[screen.surface];
  const where = screen.account ? `${base} (${accountChoiceLabel(screen.account)} account)` : base;
  const onStep = screen.step ? `${where}, on the ${STEP_LABELS[screen.step] ?? screen.step} step` : where;
  const to = screen.destination ? countryName(screen.destination) : null;
  const booking = [
    to ? `sending to ${to}` : null,
    screen.productType ? `as ${PRODUCT_TYPE_INFO[screen.productType].title}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return booking ? `${onStep}, ${booking}` : onStep;
}
