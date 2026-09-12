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
  return screen;
}

/** "account signup (E-commerce account), on the uploading documents step" */
export function describeBiaScreen(screen: BiaScreen): string {
  const base = BIA_SURFACE_LABELS[screen.surface];
  const where = screen.account ? `${base} (${accountChoiceLabel(screen.account)} account)` : base;
  return screen.step ? `${where}, on the ${STEP_LABELS[screen.step] ?? screen.step} step` : where;
}
