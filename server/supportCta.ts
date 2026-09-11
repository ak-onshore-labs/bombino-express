/**
 * The `TAP_*` button tokens in BIA's replies, checked before they leave.
 *
 * Tools hand the model tokens; the model is told to copy them through. It is
 * also a language model, so this is the backstop: every token in the final
 * reply is parsed, validated, deduplicated and moved to the end — or dropped.
 * An order button survives only if the caller owns that order.
 *
 * The client (`client/src/lib/supportMessage.ts`) renders exactly this
 * vocabulary. Add a token in both places or in neither.
 */

import { findOrderForOwner, type OrderOwner } from "./ordersDb.js";
import { normalizeOrderNo } from "./supportOrders.js";

const TOKEN_RE = /TAP_[A-Z_]+(?::[^\s]+)?/g;
const MAX_BUTTONS = 6;
/** Order-ownership lookups one reply may trigger. */
const MAX_ORDER_LOOKUPS = 5;

const AWB_RE = /^[A-Za-z0-9-]{4,32}$/;
const STATE_RE = /^[A-Za-z .&-]{2,40}$/;

export interface CtaContext {
  owner: OrderOwner | null;
  /** Order numbers a tool already proved the caller owns during this turn. */
  ownedOrderNos: ReadonlySet<string>;
  /**
   * The buttons the turn's last tool offered. Used only when the model's reply
   * carries none at all — it drops them often enough that a rate quote would
   * otherwise arrive with no way to book it.
   */
  fallbackTokens?: readonly string[];
}

/** Every `TAP_*` token in a piece of text, in order. */
export function tokensIn(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

/**
 * The reply with its buttons checked: text first, then one valid token per
 * line. Never throws — a token it cannot vouch for is simply not shown.
 */
export async function finalizeReply(message: string, ctx: CtaContext): Promise<string> {
  const own = tokensIn(message);
  const raw = own.length > 0 ? own : [...(ctx.fallbackTokens ?? [])];
  const body = message
    .replace(TOKEN_RE, "")
    // The tool output labels its button block; the model sometimes echoes it.
    .split("\n")
    .filter((line) => !/^\s*buttons\b[^a-z]*$/i.test(line) && !/^\s*buttons \(copy/i.test(line))
    .join("\n")
    // The chat renders plain text, and the prompt's "no markdown" is not always
    // obeyed: stray bold markers and heading hashes would show up literally.
    .replace(/\*\*|__/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const kept: string[] = [];
  let lookups = 0;

  for (const token of raw) {
    if (kept.length >= MAX_BUTTONS) break;
    const valid = await validateToken(token, ctx, () => lookups++ < MAX_ORDER_LOOKUPS);
    if (valid && !kept.includes(valid)) kept.push(valid);
  }

  return kept.length > 0 ? `${body}\n\n${kept.join("\n")}` : body;
}

async function validateToken(
  token: string,
  ctx: CtaContext,
  mayLookUp: () => boolean
): Promise<string | null> {
  const colon = token.indexOf(":");
  const name = colon === -1 ? token : token.slice(0, colon);
  const arg = colon === -1 ? "" : token.slice(colon + 1);
  const isAccount = ctx.owner?.kind === "account";
  const isGuest = ctx.owner?.kind === "guest";

  switch (name) {
    case "TAP_CREATE_SHIPMENT":
    case "TAP_CONTACT_US":
    case "TAP_MY_ORDERS":
      return name;
    case "TAP_CANCELLATIONS":
      return isAccount ? name : null;
    case "TAP_GUEST_PROFILE":
      return isGuest ? name : null;
    case "TAP_LOCATIONS": {
      if (!arg) return name;
      let state = "";
      try {
        state = decodeURIComponent(arg);
      } catch {
        return name;
      }
      return STATE_RE.test(state) ? `${name}:${encodeURIComponent(state)}` : name;
    }
    case "TAP_TRACK":
      // Public tracking — anyone may look up any AWB — so only the shape is checked.
      return AWB_RE.test(arg) ? `${name}:${arg.toUpperCase()}` : null;
    case "TAP_VIEW_ORDER": {
      // The order screen answers to an account only; a guest has none.
      if (!isAccount || !ctx.owner) return null;
      const orderNo = normalizeOrderNo(arg);
      if (!orderNo) return null;
      if (ctx.ownedOrderNos.has(orderNo)) return `${name}:${orderNo}`;
      if (!mayLookUp()) return null;
      const order = await findOrderForOwner({ orderNo }, ctx.owner).catch(() => null);
      return order ? `${name}:${orderNo}` : null;
    }
    default:
      return null;
  }
}
