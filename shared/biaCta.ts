/**
 * BIA's buttons: the `TAP_*` tokens a reply ends with, and what each may carry.
 *
 * One list for both ends. The server (server/supportCta.ts) uses it to decide
 * which tokens survive — adding who may see a button and whether they own the
 * order it names. The client (client/src/lib/supportMessage.ts) uses it to
 * turn a surviving token into a button. A token that is not in this list is
 * not a button anywhere.
 *
 * Tokens live in the message text, so a transcript restored from storage still
 * gets its buttons back.
 */

/**
 * Who may see a button. Ownership of an order is checked separately.
 * `no_account` is anyone without an account yet: a guest or a visitor.
 */
export type BiaButtonAudience = "anyone" | "account" | "guest" | "no_account";

interface ButtonSpec {
  audience: BiaButtonAudience;
  arg: "none" | "optional" | "required";
  /**
   * The argument in its one accepted form, or null when it is not acceptable.
   * For an optional argument, null drops the argument and keeps the button.
   */
  canonical?: (raw: string) => string | null;
  /** The argument names an order, which the caller must own. */
  ownsOrder?: boolean;
}

const STATE_RE = /^[A-Za-z .&-]{2,40}$/;

function canonicalState(raw: string): string | null {
  let state: string;
  try {
    state = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return STATE_RE.test(state) ? encodeURIComponent(state) : null;
}

function canonicalAwb(raw: string): string | null {
  return /^[A-Za-z0-9-]{4,32}$/.test(raw) ? raw.toUpperCase() : null;
}

function canonicalOrderNo(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/^#/, "");
  const match = s.match(/^(?:BOM)?[\s-]*(\d{6,9})$/);
  return match ? `BOM-${match[1]}` : null;
}

/**
 * Parts of the order page a button can open on (BIA 3.0, 4.3): what the
 * customer does themselves, on that page, and BIA never does for them.
 * Each is an element id on client/src/pages/OrderDetails.tsx.
 */
export const ORDER_SECTIONS = ["cancel", "handover-code", "pay"] as const;

export type OrderSection = (typeof ORDER_SECTIONS)[number];

function isOrderSection(value: string): value is OrderSection {
  return (ORDER_SECTIONS as readonly string[]).includes(value);
}

/**
 * An order, optionally with the section to open on: "BOM-100107#cancel".
 * An unknown section is dropped and the order kept.
 */
function canonicalOrderRef(raw: string): string | null {
  const s = raw.trim().replace(/^#/, "");
  const hash = s.indexOf("#");
  const orderNo = canonicalOrderNo(hash === -1 ? s : s.slice(0, hash));
  if (!orderNo) return null;
  // A full stop or comma the model left on the end is not part of it.
  const section = hash === -1 ? "" : s.slice(hash + 1).trim().toLowerCase().replace(/[^a-z-]+$/, "");
  return isOrderSection(section) ? `${orderNo}#${section}` : orderNo;
}

/** A TAP_VIEW_ORDER argument as its order and section. */
export function splitOrderRef(arg: string): { orderNo: string; section: OrderSection | null } {
  const hash = arg.indexOf("#");
  if (hash === -1) return { orderNo: arg, section: null };
  const section = arg.slice(hash + 1);
  return { orderNo: arg.slice(0, hash), section: isOrderSection(section) ? section : null };
}

/** The account kinds signup can open on (shared/accountMatch.ts). */
const ACCOUNT_CHOICE_RE = /^(personal|corporate|co_courier|ecommerce|fbb)$/;

function canonicalAccountChoice(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  return ACCOUNT_CHOICE_RE.test(s) ? s : null;
}

/** A signup to go back to: an account kind, or just "company" when the category isn't known. */
function canonicalSignupShape(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  return s === "company" ? s : canonicalAccountChoice(s);
}

export const BIA_BUTTONS = {
  TAP_CREATE_SHIPMENT: { audience: "anyone", arg: "none" },
  TAP_CONTACT_US: { audience: "anyone", arg: "none" },
  TAP_MY_ORDERS: { audience: "anyone", arg: "none" },
  TAP_CANCELLATIONS: { audience: "account", arg: "none" },
  TAP_GUEST_PROFILE: { audience: "guest", arg: "none" },
  TAP_LOCATIONS: { audience: "anyone", arg: "optional", canonical: canonicalState },
  // Public tracking: anyone may look up any AWB, so only the shape is checked.
  TAP_TRACK: { audience: "anyone", arg: "required", canonical: canonicalAwb },
  // The order screen answers to an account only; a guest has none. It may
  // carry the section to open on: TAP_VIEW_ORDER:BOM-100107#cancel.
  TAP_VIEW_ORDER: { audience: "account", arg: "required", canonical: canonicalOrderRef, ownsOrder: true },
  // Signup, opened on the account kind BIA recommended. Pointless once signed in.
  TAP_SIGNUP: { audience: "no_account", arg: "required", canonical: canonicalAccountChoice },
  // Back to a signup already under way, on the account kind it was for.
  TAP_RESUME_SIGNUP: { audience: "no_account", arg: "required", canonical: canonicalSignupShape },
  // The account's own documents, on Profile.
  TAP_ACCOUNT_DOCUMENTS: { audience: "account", arg: "none" },
} as const satisfies Record<string, ButtonSpec>;

export type BiaButtonName = keyof typeof BIA_BUTTONS;

export interface BiaButton {
  name: BiaButtonName;
  /** Canonical argument; "" when the button has none. */
  arg: string;
}

/** Every token-shaped string in a text. Arguments never contain whitespace. */
export const BIA_BUTTON_TOKEN_RE = /TAP_[A-Z_]+(?::[^\s]+)?/g;

function isButtonName(name: string): name is BiaButtonName {
  return Object.prototype.hasOwnProperty.call(BIA_BUTTONS, name);
}

/**
 * A token as a known button with its argument in canonical form, or null when
 * the name is unknown or a required argument is missing or malformed.
 */
export function parseBiaButton(token: string): BiaButton | null {
  const colon = token.indexOf(":");
  const name = colon === -1 ? token : token.slice(0, colon);
  const raw = colon === -1 ? "" : token.slice(colon + 1);
  if (!isButtonName(name)) return null;

  const spec: ButtonSpec = BIA_BUTTONS[name];
  if (spec.arg === "none") return { name, arg: "" };
  if (!raw) return spec.arg === "required" ? null : { name, arg: "" };
  const arg = spec.canonical ? spec.canonical(raw) : raw;
  if (arg === null) return spec.arg === "required" ? null : { name, arg: "" };
  return { name, arg };
}

/** The token for a button, as it is written into a reply. */
export function biaButtonToken(button: BiaButton): string {
  return button.arg ? `${button.name}:${button.arg}` : button.name;
}

/** Whether this kind of caller may see the button at all. */
export function biaButtonAllowedFor(name: BiaButtonName, caller: "account" | "guest" | null): boolean {
  const { audience } = BIA_BUTTONS[name] as ButtonSpec;
  if (audience === "no_account") return caller !== "account";
  return audience === "anyone" || audience === caller;
}

/** True when the button names an order the caller has to own. */
export function biaButtonNeedsOwnership(name: BiaButtonName): boolean {
  return (BIA_BUTTONS[name] as ButtonSpec).ownsOrder === true;
}

/** The order a button names, without any section: what ownership is checked on. */
export function biaButtonOrderNo(button: BiaButton): string {
  return button.name === "TAP_VIEW_ORDER" ? splitOrderRef(button.arg).orderNo : button.arg;
}
