/**
 * The `TAP_*` button tokens in BIA's replies, checked before they leave.
 *
 * Tools hand the model tokens; the model is told to copy them through. It is
 * also a language model, so this is the backstop: every token in the final
 * reply is parsed, validated, deduplicated and moved to the end — or dropped.
 * An order button survives only if the caller owns that order.
 *
 * The vocabulary — which buttons exist, what each may carry and who may see
 * it — is shared/biaCta.ts, which the client reads too. This file adds the one
 * thing only the server can know: whether the caller owns the order a button
 * names.
 */

import {
  BIA_BUTTON_TOKEN_RE,
  biaButtonAllowedFor,
  biaButtonNeedsCase,
  biaButtonNeedsOwnership,
  biaButtonOrderNo,
  biaButtonToken,
  ORDER_SECTIONS,
  parseBiaButton,
  splitOrderRef,
  type OrderSection,
} from "../shared/biaCta.js";
import { findOrderForOwner, type OrderOwner } from "./ordersDb.js";

const MAX_BUTTONS = 6;
/** Order-ownership lookups one reply may trigger. */
const MAX_ORDER_LOOKUPS = 5;

export interface CtaContext {
  owner: OrderOwner | null;
  /** Order numbers a tool already proved the caller owns during this turn. */
  ownedOrderNos: ReadonlySet<string>;
  /** Support cases this turn opened or found for the caller. A case button needs one. */
  ownedCaseNos?: ReadonlySet<string>;
  /**
   * The buttons the turn's last tool offered. Used only when the model's reply
   * carries none at all — it drops them often enough that a rate quote would
   * otherwise arrive with no way to book it.
   */
  fallbackTokens?: readonly string[];
  /**
   * Order-page sections a tool offered this turn ("BOM-100107#cancel"), and
   * the ones the customer's message asked about (`sectionsAskedAbout`). The
   * model tends to copy the plain order button even when they asked to cancel,
   * so a plain button is sent to the section they asked about when a tool
   * offered it for that order.
   */
  offeredSections?: ReadonlySet<string>;
  askedSections?: readonly OrderSection[];
}

const ASKED: Record<OrderSection, RegExp> = {
  cancel: /\bcancel/i,
  "handover-code": /\b(code|otp)\b/i,
  pay: /\bpay(ing|ment)?\b/i,
};

/** The order-page sections a customer's message is about. */
export function sectionsAskedAbout(text: string): OrderSection[] {
  return ORDER_SECTIONS.filter((s) => ASKED[s].test(text));
}

/** Every `TAP_*` token in a piece of text, in order. */
export function tokensIn(text: string): string[] {
  return text.match(BIA_BUTTON_TOKEN_RE) ?? [];
}

/**
 * The reply with its buttons checked: text first, then one valid token per
 * line. Never throws — a token it cannot vouch for is simply not shown.
 */
export async function finalizeReply(message: string, ctx: CtaContext): Promise<string> {
  const own = tokensIn(message);
  // A tool's section buttons ("…#cancel") are for when the customer asked
  // about that; nobody chose one when the reply carried no buttons at all.
  const raw = own.length > 0 ? own : (ctx.fallbackTokens ?? []).map((t) => t.replace(/#[a-z-]+\W*$/, ""));
  const body = message
    .replace(BIA_BUTTON_TOKEN_RE, "")
    // The tool output labels its button block; the model sometimes echoes it.
    .split("\n")
    .filter((line) => !/^\s*buttons\b[^a-z]*$/i.test(line) && !/^\s*buttons \(copy/i.test(line))
    // A token written with a space after its colon ("TAP_VIEW_ORDER: BOM-…")
    // leaves ": BOM-…" behind once the token is gone.
    .filter((line) => !/^\s*[-•]?\s*:\s*\S*\s*$/.test(line))
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

  const buttons = onePerOrder(kept).map((token) => toAskedSection(token, ctx));
  return buttons.length > 0 ? `${body}\n\n${buttons.join("\n")}` : body;
}

/** A plain order button, sent to the one section they asked about if a tool offered it. */
function toAskedSection(token: string, ctx: CtaContext): string {
  const button = parseBiaButton(token);
  if (button?.name !== "TAP_VIEW_ORDER" || splitOrderRef(button.arg).section) return token;
  const fits = (ctx.askedSections ?? []).filter((s) => ctx.offeredSections?.has(`${button.arg}#${s}`));
  return fits.length === 1 ? `${token}#${fits[0]}` : token;
}

/**
 * One order button per order. A section the reply chose ("…#cancel") stands in
 * for the plain button; a reply that copied several sections for one order
 * chose none of them, so it gets the plain button.
 */
export function onePerOrder(tokens: readonly string[]): string[] {
  const sections = new Map<string, Set<string>>();
  for (const token of tokens) {
    const button = parseBiaButton(token);
    if (button?.name !== "TAP_VIEW_ORDER") continue;
    const { orderNo, section } = splitOrderRef(button.arg);
    const set = sections.get(orderNo) ?? new Set<string>();
    if (section) set.add(section);
    sections.set(orderNo, set);
  }
  const out: string[] = [];
  const placed = new Set<string>();
  for (const token of tokens) {
    const button = parseBiaButton(token);
    if (button?.name !== "TAP_VIEW_ORDER") {
      out.push(token);
      continue;
    }
    const { orderNo } = splitOrderRef(button.arg);
    if (placed.has(orderNo)) continue;
    placed.add(orderNo);
    const chosen = Array.from(sections.get(orderNo) ?? []);
    out.push(chosen.length === 1 ? `TAP_VIEW_ORDER:${orderNo}#${chosen[0]}` : `TAP_VIEW_ORDER:${orderNo}`);
  }
  return out;
}

async function validateToken(
  token: string,
  ctx: CtaContext,
  mayLookUp: () => boolean
): Promise<string | null> {
  const button = parseBiaButton(token);
  if (!button) return null;
  if (!biaButtonAllowedFor(button.name, ctx.owner?.kind ?? null)) return null;

  if (biaButtonNeedsOwnership(button.name)) {
    if (!ctx.owner) return null;
    const orderNo = biaButtonOrderNo(button);
    if (!ctx.ownedOrderNos.has(orderNo)) {
      if (!mayLookUp()) return null;
      const order = await findOrderForOwner({ orderNo }, ctx.owner).catch(() => null);
      if (!order) return null;
    }
  }
  // Only a case this turn's escalation opened or found: never one the model typed.
  if (biaButtonNeedsCase(button.name) && !ctx.ownedCaseNos?.has(button.arg)) return null;
  return biaButtonToken(button);
}
