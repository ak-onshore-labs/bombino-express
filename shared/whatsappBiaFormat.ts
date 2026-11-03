/**
 * A BIA reply, as WhatsApp messages.
 *
 * The app shows BIA's answer with buttons (TAP_* tokens), suggestion chips and
 * cards (shared/biaCta.ts, shared/biaCards.ts). WhatsApp has none of those, so:
 *
 *   TAP_* tokens  →  link buttons ("cta_url"), one per message, that open the
 *                    same page of the website. TAP_CONTACT_US becomes the
 *                    phone number: the customer is already on WhatsApp.
 *   suggestions   →  quick-reply buttons (up to 3 short ones) or a list. The
 *                    reply comes back with the suggestion as its id.
 *   cards         →  short text blocks under the answer.
 *
 * Pure: no sending, no environment. server/whatsappBia.ts sends the parts.
 */

import { BIA_BUTTON_TOKEN_RE, parseBiaButton, splitOrderRef, type BiaButton } from "./biaCta.js";
import type { BiaCard } from "./biaCards.js";
import { signupPathFor, type AccountChoice } from "./accountMatch.js";

export const WA_TEXT_MAX = 4096;
/** Interactive messages (buttons, lists, links) take a shorter body. */
export const WA_INTERACTIVE_BODY_MAX = 1024;
export const WA_BUTTON_TITLE_MAX = 20;
export const WA_LIST_ROW_TITLE_MAX = 24;
export const WA_LIST_ROW_DESCRIPTION_MAX = 72;
/** Link buttons sent per reply. More than this is noise. */
export const WA_MAX_LINKS = 2;

/** A quick reply's id carries the suggestion itself, so the tap reads as the question. */
export const SUGGESTION_ID_PREFIX = "s:";
export const NOT_ME_ID = "bia:not_me";
export const USE_ACCOUNT_ID = "bia:use_account";

export type WaPart =
  | { kind: "text"; body: string }
  | { kind: "buttons"; body: string; buttons: { id: string; title: string }[] }
  | { kind: "list"; body: string; button: string; rows: { id: string; title: string; description?: string }[] }
  | { kind: "cta"; body: string; label: string; url: string };

export interface WaLink {
  label: string;
  path: string;
}

const ORDER_SECTION_LABEL = { pay: "Pay now", cancel: "Request cancel", "handover-code": "See your code" } as const;

/** Where a BIA button goes on the website, or null when it is not a link here. */
export function linkFor(button: BiaButton): WaLink | null {
  switch (button.name) {
    case "TAP_CREATE_SHIPMENT":
      return { label: "Book a shipment", path: "/create" };
    case "TAP_CONTACT_US":
      return null;
    case "TAP_MY_ORDERS":
      return { label: "My orders", path: "/orders" };
    case "TAP_CANCELLATIONS":
      return { label: "Cancellations", path: "/orders?tab=cancellations" };
    case "TAP_GUEST_PROFILE":
      return { label: "My bookings", path: "/guest-profile" };
    case "TAP_LOCATIONS":
      return {
        label: "Drop-off counters",
        path: button.arg ? `/locations?near=${encodeURIComponent(decodeURIComponent(button.arg))}` : "/locations",
      };
    case "TAP_TRACK":
      return { label: "Track shipment", path: `/shipment/${encodeURIComponent(button.arg)}` };
    case "TAP_VIEW_ORDER": {
      const { orderNo, section } = splitOrderRef(button.arg);
      return {
        // Which order, since a reply can carry two of these.
        label: section ? ORDER_SECTION_LABEL[section] : `Open ${orderNo}`,
        path: `/order/${encodeURIComponent(orderNo)}${section ? `#${section}` : ""}`,
      };
    }
    case "TAP_SIGNUP":
      return { label: "Open an account", path: signupPathFor(button.arg as AccountChoice) };
    case "TAP_RESUME_SIGNUP":
      return { label: "Continue signup", path: signupPathFor(button.arg as AccountChoice | "company") };
    case "TAP_ACCOUNT_DOCUMENTS":
      return { label: "My documents", path: "/profile#documents" };
  }
}

function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** One card as a few plain lines. */
export function cardText(card: BiaCard): string {
  switch (card.kind) {
    case "order": {
      const id = card.orderNo ?? (card.awb ? `AWB ${card.awb}` : "Shipment");
      const meta = [
        card.destination && card.destination !== "—" ? `To ${card.destination}` : null,
        card.orderNo && card.awb ? `AWB ${card.awb}` : null,
        card.bookedOn ? `booked ${card.bookedOn}` : null,
      ].filter(Boolean);
      return `*${id}* · ${card.status}${meta.length ? `\n${meta.join(" · ")}` : ""}`;
    }
    case "pickup": {
      const where = card.place ? `${card.pincode} (${card.place})` : card.pincode;
      if (card.available) {
        const when = [card.earliest ? `earliest ${card.earliest}` : null, card.cutoff ? `book by ${card.cutoff}` : null]
          .filter(Boolean)
          .join(", ");
        return `Pickup at ${where}: available${when ? `, ${when}` : ""}.${card.outOfCity ? " An extra charge may apply." : ""}`;
      }
      const counters = card.counters.slice(0, 3).map((c) => `- ${c.city}: ${c.address}`);
      return [`No pickup at ${where}.`, ...(counters.length ? ["Nearest drop-off counters:", ...counters] : [])].join("\n");
    }
    case "rate":
      return [
        `Rates to ${card.destination}, ${card.weightKg} kg:`,
        ...card.services.slice(0, 5).map((s) => `- ${s.name}: ${inr(s.amount)}`),
      ].join("\n");
    case "checklist":
      return [
        `${card.title} needs:`,
        ...card.documents.map((d) => `- ${d.label}${d.hint ? `: ${d.hint}` : ""}`),
        ...(card.fields.length ? [`Details: ${card.fields.join(", ")}`] : []),
      ].join("\n");
    case "docStatus": {
      const head = card.total !== null ? `${card.title} (${card.done} of ${card.total} on file):` : `${card.title}:`;
      const state = { on_file: "on file", attention: "needs attention", missing: "to upload" } as const;
      return [head, ...card.items.map((i) => `- ${i.label}: ${state[i.state]}${i.note ? ` (${i.note})` : ""}`)].join("\n");
    }
    case "hsn":
      return [
        `Contents codes for "${card.item}":`,
        ...card.candidates.map((c) => `- ${c.description}: ${c.code}`),
      ].join("\n");
  }
}

/** Split on paragraph or line breaks where possible; a hard cut only as a last resort. */
export function chunk(text: string, limit: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = window.lastIndexOf("\n\n");
    if (cut < limit * 0.5) cut = window.lastIndexOf("\n");
    if (cut < limit * 0.5) cut = window.lastIndexOf(" ");
    if (cut < limit * 0.5) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Quick replies for the chips: buttons when all fit, else a list. */
export function suggestionPart(body: string, suggestions: string[]): WaPart | null {
  const items = suggestions.map((s) => s.trim()).filter(Boolean).slice(0, 10);
  if (items.length === 0) return null;
  const id = (s: string) => `${SUGGESTION_ID_PREFIX}${s.slice(0, 200)}`;
  if (items.length <= 3 && items.every((s) => s.length <= WA_BUTTON_TITLE_MAX)) {
    return { kind: "buttons", body, buttons: items.map((s) => ({ id: id(s), title: s })) };
  }
  return {
    kind: "list",
    body,
    button: "Quick questions",
    rows: items.map((s) => ({
      id: id(s),
      title: clip(s, WA_LIST_ROW_TITLE_MAX),
      ...(s.length > WA_LIST_ROW_TITLE_MAX ? { description: clip(s, WA_LIST_ROW_DESCRIPTION_MAX) } : {}),
    })),
  };
}

export function formatBiaReply(input: {
  message: string;
  suggestions: string[];
  cards: BiaCard[];
  /** The website's origin, e.g. https://bombino.onshorelabs.co.in. Empty: links become plain text. */
  appUrl: string;
  supportPhone: string;
}): WaPart[] {
  const base = input.appUrl.replace(/\/+$/, "");
  const links: WaLink[] = [];
  const seen = new Set<string>();
  let contact = false;

  for (const token of input.message.match(BIA_BUTTON_TOKEN_RE) ?? []) {
    const button = parseBiaButton(token);
    if (!button) continue;
    if (button.name === "TAP_CONTACT_US") {
      contact = true;
      continue;
    }
    const link = linkFor(button);
    if (link && !seen.has(link.path)) {
      seen.add(link.path);
      links.push(link);
    }
  }

  let text = input.message
    .replace(BIA_BUTTON_TOKEN_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // An order the answer already names is not listed again underneath: in the
  // app the card is a tappable tile, here it would only repeat the text.
  const cards = input.cards.filter(
    (c) => c.kind !== "order" || !(c.orderNo ? text.includes(c.orderNo) : c.awb ? text.includes(c.awb) : false)
  );
  const cardBlock = cards.map(cardText).join("\n\n");
  if (cardBlock) text = text ? `${text}\n\n${cardBlock}` : cardBlock;
  if (contact) text = `${text}\n\nTalk to our team: call ${input.supportPhone}`.trim();
  if (!text) text = "I can help with your orders, rates, tracking and how Bombino works. What do you need?";

  const usable = base ? links.slice(0, WA_MAX_LINKS) : [];
  if (!base && links.length) {
    text = `${text}\n\nOpen the Bombino app for: ${links.map((l) => l.label).join(", ")}.`;
  }

  const parts: WaPart[] = [];
  const quick = (body: string) => suggestionPart(body, input.suggestions);

  if (usable.length === 0) {
    // The answer itself carries the quick replies when they fit its body.
    const chunks = chunk(text, WA_TEXT_MAX);
    const last = chunks.pop() ?? "";
    for (const c of chunks) parts.push({ kind: "text", body: c });
    const q = last.length <= WA_INTERACTIVE_BODY_MAX ? quick(last) : null;
    if (q) parts.push(q);
    else {
      parts.push({ kind: "text", body: last });
      const after = quick("Anything else?");
      if (after) parts.push(after);
    }
    return parts;
  }

  // Links: the answer's last part carries the first link; any second link
  // follows as its own small message.
  const chunks = chunk(text, WA_INTERACTIVE_BODY_MAX);
  const last = chunks.pop() ?? "";
  for (const c of chunks) parts.push({ kind: "text", body: c });
  const [first, ...rest] = usable;
  parts.push({ kind: "cta", body: last, label: clip(first.label, WA_BUTTON_TITLE_MAX), url: `${base}${first.path}` });
  for (const l of rest) {
    parts.push({ kind: "cta", body: `Or: ${l.label}`, label: clip(l.label, WA_BUTTON_TITLE_MAX), url: `${base}${l.path}` });
  }
  const after = quick("Anything else?");
  if (after) parts.push(after);
  return parts;
}

/** What an inbound tap means: a suggestion's text, an identity choice, or the typed text. */
export function inboundText(raw: string): { kind: "text"; text: string } | { kind: "not_me" } | { kind: "use_account" } {
  const t = raw.trim();
  if (t === NOT_ME_ID) return { kind: "not_me" };
  if (t === USE_ACCOUNT_ID) return { kind: "use_account" };
  if (t.startsWith(SUGGESTION_ID_PREFIX)) return { kind: "text", text: t.slice(SUGGESTION_ID_PREFIX.length).trim() };
  return { kind: "text", text: t };
}

/** "Aditya Kamarouthu" → "A***** K." — enough for the owner to recognise, little for anyone else. */
export function maskedName(fullName: string | null | undefined): string | null {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0]!;
  const masked = `${first[0]!.toUpperCase()}${"*".repeat(Math.max(2, Math.min(first.length - 1, 6)))}`;
  const last = parts.length > 1 ? ` ${parts[parts.length - 1]![0]!.toUpperCase()}.` : "";
  return `${masked}${last}`;
}
