/**
 * Types for BIA, the Bombino AI support assistant.
 * No runtime logic — interfaces and constants only.
 */

import type OpenAI from "openai";
import type { BiaCard } from "../shared/biaCards.js";
import type { BiaModule, BiaModuleOrGeneral } from "../shared/biaModules.js";
import type { BiaScreen } from "../shared/biaScreen.js";

// ─── Chat API ───────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
}

export interface ChatResponse {
  message: string;
  sessionId?: string | null;
  /** Quick replies for the turn just answered. Not stored with the transcript. */
  suggestions?: string[];
  /** Structured cards for the turn just answered. Not stored with the transcript. */
  cards?: BiaCard[];
  /** Names this answer for a thumbs up or down (POST /api/support/feedback). */
  turnId?: string;
}

/** What a turn was, for the turn log (server/supportTelemetry.ts). No text. */
export interface SupportTurnMeta {
  modules: string[];
  /** Tools called, in order, repeats included. */
  tools: string[];
  /** True when the reply is a canned one because BIA could not answer. */
  fallback: boolean;
  promptTokens: number;
  completionTokens: number;
}

/** What handleChat hands back to the route. */
export interface SupportChatResult {
  message: string;
  suggestions: string[];
  cards: BiaCard[];
  meta: SupportTurnMeta;
}

export interface SupportChatContext {
  user: {
    id: string;
    email: string;
    fullName: string;
    code: string;
  } | null;
  itdToken: string | null;
  dbUserId: string | null;
  sessionId: string | null;
  /**
   * The guest booking identity, minted only by verifying an OTP on
   * `guestPhone` (see session.d.ts). Null for an account or an anonymous
   * visitor. Every order tool resolves ownership from here or `dbUserId` —
   * never from anything the model passes in.
   */
  guestRef: string | null;
  guestPhone: string | null;
  /**
   * The signup this browser has under way, for the number it last verified
   * (`req.session.signupRef` while `signupPhone` is set). Null once signed in,
   * or before signup has recorded anything. Its rows are read by
   * get_signup_progress and by nothing else in BIA.
   */
  signupRef?: string | null;
  /**
   * Where the customer opened BIA from, already reduced by parseBiaScreen to
   * known values. A hint, never proof: an order number here is still looked
   * up with ownership checked. Null when the client sent none.
   */
  screen: BiaScreen | null;
  /**
   * Set by handleChat for the turn under way, for a tool that needs more than
   * the session: the modules this turn was offered, and the conversation so
   * far (identity numbers already masked by supportPrivacy.ts). Only
   * escalate_support reads them, to open a support case.
   */
  modules?: readonly BiaModule[];
  transcript?: readonly ChatMessage[];
  /** The id the route minted for this turn's answer, for a case to record. */
  turnId?: string | null;
}

// ─── Tool arguments (LLM → executor) ─────────────────────────────────────────

export interface GetRatesArgs {
  /** Origin country name or code; defaults to India in executor */
  origin_country?: string;
  destination_country: string;
  weight_kg: string;
}

export interface GetTrackingSummaryArgs {
  tracking_no: string;
}

export interface GetOrderStatusArgs {
  order_no: string;
}

export interface CheckPickupArgs {
  pincode: string;
}

// ─── Normalized tracking summary (internal; used to build string for LLM) ────

export interface TrackingSummaryLastEvent {
  description: string;
  location: string;
  at: string;
}

export interface TrackingSummary {
  status: string;
  tracking_no: string;
  origin: string;
  destination: string;
  booking_date: string;
  last_event: TrackingSummaryLastEvent | null;
  events_count: number;
  chargeable_weight: string;
}

// ─── Tool outcome ────────────────────────────────────────────────────────────

/**
 * What a tool executor returns. `content` goes to the model; `orderNos` are the
 * order numbers the tool proved the caller owns, so a `TAP_VIEW_ORDER` button
 * naming one of them can be kept without a second lookup; `cards` go to the
 * client and never to the model.
 */
export interface ToolOutcome {
  content: string;
  orderNos?: string[];
  /** Support cases this tool opened or found for the caller, so their WhatsApp button survives. */
  caseNos?: string[];
  /** Cards for the reply, built from data this tool already checked. */
  cards?: BiaCard[];
}

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * One tool BIA can call. Each module's file exports its own list
 * (GENERAL_TOOLS in supportGeneral.ts, ORDER_TOOLS in supportOrders.ts) and
 * supportTools.ts gathers them, so adding a tool never touches supportAgent.ts.
 */
export interface BiaTool {
  /** Its module: a turn is only offered the tools of enabled modules. */
  module: BiaModuleOrGeneral;
  /** What the model is told about it; `function.name` is its name. */
  definition: OpenAI.Chat.Completions.ChatCompletionTool;
  /**
   * Runs it with the model's arguments, JSON-parsed but unchecked — the tool
   * coerces what it needs. Must not throw.
   */
  run: (args: Record<string, unknown>, context: SupportChatContext) => Promise<ToolOutcome>;
  /** Old names a replayed transcript might still call it by. */
  aliases?: readonly string[];
}

// ─── Validation constants ───────────────────────────────────────────────────

export const SUPPORT_CHAT_MAX_MESSAGES = 50;
export const SUPPORT_CHAT_MAX_CONTENT_LENGTH = 4096;
export const SUPPORT_TRACKING_NO_MAX_LENGTH = 32;
