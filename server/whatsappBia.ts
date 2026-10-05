/**
 * ── BIA on WhatsApp ─────────────────────────────────────────────────────────
 *
 *   WHATSAPP_BIA=1
 *
 * The same BIA as the app (supportAgent.handleChat), answering messages that
 * reach the WhatsApp webhook (routes/whatsapp.ts). Off unless the flag is set,
 * because the old guest-only WhatsApp BIA is live on another deployment and two
 * bots answering one number would reply twice.
 *
 * ── Who is asking ───────────────────────────────────────────────────────────
 *
 * The sender's number, as WhatsApp delivers it. WhatsApp has already proved
 * the sender holds that number; our pickup-code and order messages rest on the
 * same fact. So there is no OTP here (Aditya, 5 Oct 2026): the number is looked
 * up as an account, else as a guest's bookings, else the person is a visitor.
 *
 * The first time an identified number writes, BIA says whose account it sees,
 * with the name masked, and offers "Not me". Tapping it makes this chat answer
 * as a visitor until they tap "It's me". That is the way out for a shared or
 * recycled number.
 *
 * ── Rules ───────────────────────────────────────────────────────────────────
 *
 * Exactly the app's (BIA 3.0): BIA only guides. It never cancels, pays, books
 * or uploads, and never states a pickup or drop-off code; it gives the link to
 * the page that does. Staff accounts (agents, ops) are answered as visitors:
 * BIA's order tools are for customers.
 */

import crypto from "crypto";

import { handleChat } from "./supportAgent.js";
import { maskSensitive } from "./supportPrivacy.js";
import { recordTurn } from "./supportTelemetry.js";
import { SUPPORT_CHAT_MAX_CONTENT_LENGTH, type ChatMessage, type SupportChatContext } from "./supportTypes.js";
import { supabase } from "./supabaseClient.js";
import { getLatestGuestRefForPhone } from "./guestProfileDb.js";
import { sendSessionPart } from "./whatsapp.js";
import {
  countMessage,
  historyFor,
  isDuplicate,
  loadConversation,
  saveConversation,
  WA_RATE_LIMIT_PER_HOUR,
} from "./whatsappBiaStore.js";
import {
  formatBiaReply,
  inboundText,
  maskedName,
  NOT_ME_ID,
  USE_ACCOUNT_ID,
  type WaPart,
} from "../shared/whatsappBiaFormat.js";

const DEFAULT_APP_URL = "https://bombino.onshorelabs.co.in";
const SUPPORT_PHONE = "+91 22 6640 0000";

export function isWhatsappBiaEnabled(): boolean {
  return process.env.WHATSAPP_BIA?.trim() === "1";
}

/** The website BIA's links open. Not PUBLIC_URL, which is this server's own host. */
function appUrl(): string {
  return (process.env.APP_URL ?? DEFAULT_APP_URL).trim();
}

export type WaIdentity =
  | { kind: "account"; dbUserId: string; user: NonNullable<SupportChatContext["user"]> }
  | { kind: "guest"; guestRef: string; phone: string }
  | { kind: "visitor" };

/** "919876543210" → "9876543210". Numbers outside India have no account here. */
export function localIndianNumber(waNumber: string): string | null {
  const digits = waNumber.replace(/\D/g, "");
  return /^91[6-9]\d{9}$/.test(digits) ? digits.slice(2) : null;
}

/** Whose number this is: a customer account, a guest's bookings, or nobody we know. */
export async function identify(waNumber: string): Promise<WaIdentity> {
  const local = localIndianNumber(waNumber);
  if (!local || !supabase) return { kind: "visitor" };

  const { data, error } = await supabase
    .from("itd_users")
    .select("id, full_name, email, itd_customer_id, itd_customer_code, role")
    .eq("phone", local)
    .limit(2);
  if (error) console.error("[whatsappBia] account lookup failed:", error.message);

  // Exactly one customer account on the number. Two would be ambiguous, and a
  // staff login is not someone whose orders BIA should read out.
  const customers = (data ?? []).filter((r) => !r.role || r.role === "customer");
  if (customers.length === 1) {
    const r = customers[0]!;
    return {
      kind: "account",
      dbUserId: String(r.id),
      user: {
        id: String(r.itd_customer_id ?? r.id),
        email: String(r.email ?? ""),
        fullName: String(r.full_name ?? ""),
        code: String(r.itd_customer_code ?? ""),
      },
    };
  }

  const guestRef = await getLatestGuestRefForPhone(local);
  if (guestRef) return { kind: "guest", guestRef, phone: local };
  return { kind: "visitor" };
}

function contextFor(identity: WaIdentity): SupportChatContext {
  return {
    user: identity.kind === "account" ? identity.user : null,
    itdToken: null,
    dbUserId: identity.kind === "account" ? identity.dbUserId : null,
    sessionId: null,
    guestRef: identity.kind === "guest" ? identity.guestRef : null,
    guestPhone: identity.kind === "guest" ? identity.phone : null,
    signupRef: null,
    screen: null,
    channel: "whatsapp",
  };
}

/** The one-time note on whose account BIA sees, with the way out. */
export function greetingPart(identity: WaIdentity): WaPart | null {
  if (identity.kind === "visitor") return null;
  const who =
    identity.kind === "account"
      ? `the Bombino account of ${maskedName(identity.user.fullName) ?? "a customer"}`
      : "Bombino bookings made from this number";
  return {
    kind: "buttons",
    body: `Hi, I'm BIA, Bombino's assistant. I can see ${who} on this WhatsApp number, so I can answer questions about those shipments here.\n\nNot you? Tap below and I won't use it in this chat.`,
    buttons: [{ id: NOT_ME_ID, title: "Not me" }],
  };
}

async function send(waNumber: string, parts: WaPart[]): Promise<void> {
  // In order: WhatsApp shows them as they arrive.
  for (const part of parts) await sendSessionPart(waNumber, part);
}

function mask(waNumber: string): string {
  return `…${waNumber.slice(-4)}`;
}

/**
 * Answer one inbound WhatsApp message. Never throws: the webhook has already
 * told Tata 200, and a customer must get a reply or, failing that, an apology.
 */
export async function handleWhatsappBiaMessage(input: { from: string; messageId: string; text: string }): Promise<void> {
  const waNumber = input.from.replace(/\D/g, "");
  if (!waNumber || !input.text.trim()) return;
  const startedAt = Date.now();

  try {
    let conv = await loadConversation(waNumber);
    if (isDuplicate(conv, input.messageId)) return;
    conv = { ...conv, recentMessageIds: [...conv.recentMessageIds, input.messageId] };

    const counted = countMessage(conv, startedAt);
    conv = counted.next;
    if (counted.limited) {
      // Said once, on the first message over the limit; after that, silence
      // until the hour is up rather than a reply to every message.
      if (conv.windowCount === WA_RATE_LIMIT_PER_HOUR + 1) {
        await send(waNumber, [
          { kind: "text", body: `That's a lot of messages in an hour, so I'm taking a short break. Try again in a little while, or call our team on ${SUPPORT_PHONE}.` },
        ]);
      }
      await saveConversation(conv);
      return;
    }

    const intent = inboundText(input.text);
    if (intent.kind === "not_me") {
      conv = { ...conv, identityDeclined: true, messages: [] };
      await saveConversation(conv);
      await send(waNumber, [
        {
          kind: "buttons",
          body: "Thanks for telling me. I won't use the account on this number here. I can still help with rates, tracking an AWB and how Bombino works.",
          buttons: [{ id: USE_ACCOUNT_ID, title: "It's me after all" }],
        },
      ]);
      return;
    }
    if (intent.kind === "use_account") {
      conv = { ...conv, identityDeclined: false, messages: [] };
      await saveConversation(conv);
      await send(waNumber, [{ kind: "text", body: "Done, I'll use your Bombino account again. What would you like to know?" }]);
      return;
    }

    const identity: WaIdentity = conv.identityDeclined ? { kind: "visitor" } : await identify(waNumber);
    const context = contextFor(identity);

    if (!conv.greetedAt && identity.kind !== "visitor") {
      const greeting = greetingPart(identity);
      if (greeting) await send(waNumber, [greeting]);
      conv = { ...conv, greetedAt: new Date(startedAt).toISOString() };
    }

    // Identity numbers masked before the model or the transcript sees them,
    // as in the app (server/supportPrivacy.ts).
    const userText = maskSensitive(intent.text.slice(0, SUPPORT_CHAT_MAX_CONTENT_LENGTH));
    const history = historyFor(conv, startedAt);
    const messages: ChatMessage[] = [...history, { role: "user", content: userText }];

    const { message, suggestions, cards, meta } = await handleChat(messages, context);
    await send(waNumber, formatBiaReply({ message, suggestions, cards, appUrl: appUrl(), supportPhone: SUPPORT_PHONE }));

    conv = {
      ...conv,
      messages: [...messages, { role: "assistant", content: message }],
      lastInboundAt: new Date(startedAt).toISOString(),
    };
    await saveConversation(conv);

    void recordTurn({
      id: crypto.randomUUID(),
      sessionId: null,
      ownerKind: identity.kind === "account" ? "account" : identity.kind === "guest" ? "guest" : "anon",
      userId: identity.kind === "account" ? identity.dbUserId : null,
      guestRef: identity.kind === "guest" ? identity.guestRef : null,
      surface: "whatsapp",
      step: null,
      errorCode: null,
      modules: meta.modules,
      tools: meta.tools,
      cardKinds: cards.map((c) => c.kind),
      latencyMs: Date.now() - startedAt,
      fallback: meta.fallback,
      promptTokens: meta.promptTokens,
      completionTokens: meta.completionTokens,
    });
    console.log(`[whatsappBia] replied to ${mask(waNumber)} as ${identity.kind} in ${Date.now() - startedAt}ms`);
  } catch (err) {
    console.error("[whatsappBia] failed:", err instanceof Error ? err.message : err);
    await sendSessionPart(waNumber, {
      kind: "text",
      body: `Sorry, I couldn't answer that just now. Please try again in a moment, or call our team on ${SUPPORT_PHONE}.`,
    });
  }
}
