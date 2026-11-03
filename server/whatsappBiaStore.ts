/**
 * WhatsApp BIA's per-number state: recent turns, the one-time greeting, a
 * declined identity, answered message ids, and the hourly limit.
 *
 * Kept in `whatsapp_bia_conversations`
 * (migrations/create_whatsapp_bia_conversations.sql). Until that has run, or
 * whenever the database is unreachable, the same state lives in memory: lost on
 * restart and not shared between instances, but BIA keeps answering. A missing
 * table must never be the reason a customer gets silence.
 */

import { supabase } from "./supabaseClient.js";
import type { ChatMessage } from "./supportTypes.js";

const TABLE = "whatsapp_bia_conversations";

/** Turns kept for context: enough for a follow-up, far below the chat limit. */
export const WA_HISTORY_MAX_MESSAGES = 20;
/** A conversation idle this long starts fresh, so old context doesn't leak into a new question. */
export const WA_HISTORY_IDLE_MS = 6 * 60 * 60 * 1000;
/** Message ids remembered for de-duplication; Tata retries for minutes. */
const RECENT_IDS_MAX = 40;
/** Per-number limit. A rate quote plus tracking takes 6 or 7 messages. */
export const WA_RATE_LIMIT_PER_HOUR = 30;

export interface WaConversation {
  waNumber: string;
  messages: ChatMessage[];
  greetedAt: string | null;
  identityDeclined: boolean;
  recentMessageIds: string[];
  windowStartedAt: string | null;
  windowCount: number;
  lastInboundAt: string | null;
}

function blank(waNumber: string): WaConversation {
  return {
    waNumber,
    messages: [],
    greetedAt: null,
    identityDeclined: false,
    recentMessageIds: [],
    windowStartedAt: null,
    windowCount: 0,
    lastInboundAt: null,
  };
}

const memory = new Map<string, WaConversation>();
let tableMissingWarned = false;

function warnFallback(reason: string): void {
  if (tableMissingWarned) return;
  tableMissingWarned = true;
  console.warn(`[whatsappBia] conversation table unavailable (${reason}); keeping state in memory until it is`);
}

function parseMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is ChatMessage =>
      !!m &&
      typeof m === "object" &&
      ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
      typeof (m as ChatMessage).content === "string"
  );
}

export async function loadConversation(waNumber: string): Promise<WaConversation> {
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("wa_number, messages, greeted_at, identity_declined, recent_message_ids, window_started_at, window_count, last_inbound_at")
      .eq("wa_number", waNumber)
      .maybeSingle();
    if (!error) {
      if (!data) return memory.get(waNumber) ?? blank(waNumber);
      return {
        waNumber,
        messages: parseMessages(data.messages),
        greetedAt: (data.greeted_at as string | null) ?? null,
        identityDeclined: data.identity_declined === true,
        recentMessageIds: Array.isArray(data.recent_message_ids) ? (data.recent_message_ids as string[]) : [],
        windowStartedAt: (data.window_started_at as string | null) ?? null,
        windowCount: typeof data.window_count === "number" ? data.window_count : 0,
        lastInboundAt: (data.last_inbound_at as string | null) ?? null,
      };
    }
    warnFallback(error.message);
  }
  return memory.get(waNumber) ?? blank(waNumber);
}

export async function saveConversation(c: WaConversation): Promise<void> {
  const trimmed: WaConversation = {
    ...c,
    messages: c.messages.slice(-WA_HISTORY_MAX_MESSAGES),
    recentMessageIds: c.recentMessageIds.slice(-RECENT_IDS_MAX),
  };
  memory.set(c.waNumber, trimmed);
  if (!supabase) return;

  const { error } = await supabase.from(TABLE).upsert(
    {
      wa_number: trimmed.waNumber,
      messages: trimmed.messages,
      greeted_at: trimmed.greetedAt,
      identity_declined: trimmed.identityDeclined,
      recent_message_ids: trimmed.recentMessageIds,
      window_started_at: trimmed.windowStartedAt,
      window_count: trimmed.windowCount,
      last_inbound_at: trimmed.lastInboundAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wa_number" }
  );
  if (error) warnFallback(error.message);
}

// ── Pure rules, exported for tests ─────────────────────────────────────────

/** True when this message id has been answered already. */
export function isDuplicate(c: WaConversation, messageId: string): boolean {
  return c.recentMessageIds.includes(messageId);
}

/**
 * Count one inbound message against the hourly limit. Returns the updated
 * conversation and whether this message is over the limit.
 */
export function countMessage(c: WaConversation, now: number): { next: WaConversation; limited: boolean } {
  const started = c.windowStartedAt ? Date.parse(c.windowStartedAt) : NaN;
  const fresh = !Number.isFinite(started) || now - started >= 60 * 60 * 1000;
  const windowCount = (fresh ? 0 : c.windowCount) + 1;
  return {
    next: {
      ...c,
      windowStartedAt: fresh ? new Date(now).toISOString() : c.windowStartedAt,
      windowCount,
    },
    limited: windowCount > WA_RATE_LIMIT_PER_HOUR,
  };
}

/** The turns to send BIA as context: none once the chat has gone quiet for a while. */
export function historyFor(c: WaConversation, now: number): ChatMessage[] {
  const last = c.lastInboundAt ? Date.parse(c.lastInboundAt) : NaN;
  if (!Number.isFinite(last) || now - last > WA_HISTORY_IDLE_MS) return [];
  return c.messages;
}
