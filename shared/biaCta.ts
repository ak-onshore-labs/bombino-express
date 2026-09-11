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

/** Who may see a button. Ownership of an order is checked separately. */
export type BiaButtonAudience = "anyone" | "account" | "guest";

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

export const BIA_BUTTONS = {
  TAP_CREATE_SHIPMENT: { audience: "anyone", arg: "none" },
  TAP_CONTACT_US: { audience: "anyone", arg: "none" },
  TAP_MY_ORDERS: { audience: "anyone", arg: "none" },
  TAP_CANCELLATIONS: { audience: "account", arg: "none" },
  TAP_GUEST_PROFILE: { audience: "guest", arg: "none" },
  TAP_LOCATIONS: { audience: "anyone", arg: "optional", canonical: canonicalState },
  // Public tracking: anyone may look up any AWB, so only the shape is checked.
  TAP_TRACK: { audience: "anyone", arg: "required", canonical: canonicalAwb },
  // The order screen answers to an account only; a guest has none.
  TAP_VIEW_ORDER: { audience: "account", arg: "required", canonical: canonicalOrderNo, ownsOrder: true },
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
  return audience === "anyone" || audience === caller;
}

/** True when the button names an order the caller has to own. */
export function biaButtonNeedsOwnership(name: BiaButtonName): boolean {
  return (BIA_BUTTONS[name] as ButtonSpec).ownsOrder === true;
}
