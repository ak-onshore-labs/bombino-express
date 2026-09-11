/**
 * Types for BIA, the Bombino AI support assistant.
 * No runtime logic — interfaces and constants only.
 */

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
}

/** What handleChat hands back to the route. */
export interface SupportChatResult {
  message: string;
  suggestions: string[];
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
 * naming one of them can be kept without a second lookup.
 */
export interface ToolOutcome {
  content: string;
  orderNos?: string[];
}

// ─── Validation constants ───────────────────────────────────────────────────

export const SUPPORT_CHAT_MAX_MESSAGES = 50;
export const SUPPORT_CHAT_MAX_CONTENT_LENGTH = 4096;
export const SUPPORT_TRACKING_NO_MAX_LENGTH = 32;
