/**
 * BIA — the Bombino AI support agent: tool executors, dispatcher, and OpenAI
 * orchestration.
 *
 * Read-only by design. BIA answers from live data and points at the screen
 * where the customer can act; it never changes an order, takes a payment or
 * issues a code. Order tools live in `supportOrders.ts` and resolve ownership
 * from the session; replies pass through `supportCta.ts` before they leave.
 *
 * Executors never throw and never expose internal errors: each returns a safe
 * string, and handleChat falls back to a canned reply.
 */

import OpenAI from "openai";
import { itdClient } from "./itd.js";
import type { ITDTrackingResult } from "./itd.js";
import { guidance, escalation } from "./supportContent.js";
import type { GuidanceKey } from "./supportContent.js";
import { finalizeReply, tokensIn } from "./supportCta.js";
import {
  describeOwnedOrderByAwb,
  executeCheckPickup,
  executeGetMyKycStatus,
  executeGetOrderStatus,
  executeListMyOrders,
  formatInr,
  ownerOf,
} from "./supportOrders.js";
import type {
  SupportChatContext,
  SupportChatResult,
  ToolOutcome,
  TrackingSummary,
  TrackingSummaryLastEvent,
} from "./supportTypes.js";
import {
  SUPPORT_TRACKING_NO_MAX_LENGTH,
  type ChatMessage,
  type GetRatesArgs,
  type GetTrackingSummaryArgs,
} from "./supportTypes.js";
import { isBookableCorridor } from "../shared/corridor.js";

// ─── Fallback strings (never expose internal errors) ───────────────────────────

const FALLBACK_RATES =
  "I couldn't get rates for that route right now. Please try the Rates page in the app or contact support.";
const FALLBACK_RATES_NO_DESTINATION =
  "Please tell me which country you're shipping to so I can quote a rate.";
const FALLBACK_RATES_INVALID_WEIGHT =
  "Please provide a valid parcel weight in kilograms (e.g. 2 or 2.5).";
const FALLBACK_TRACKING =
  "I couldn't find tracking for that number. Please check the AWB or contact support.";
const FALLBACK_TRACKING_NO_INPUT = "Please provide an AWB or tracking number.";
const FALLBACK_TRACKING_TOO_LONG =
  "Tracking number is too long; please check and try again.";
const FALLBACK_GUIDANCE = guidance.general;
const FALLBACK_ESCALATION =
  "Please use the app menu to reach support (WhatsApp or Call).";
const FALLBACK_DISPATCHER =
  "Something went wrong. Please try again or contact support from the app menu.";
const FALLBACK_CHAT =
  "I'm having trouble responding right now. Please try again in a moment or use the app menu to contact support.";
const SUPPORT_CHAT_MAX_TOOL_ITERATIONS = 5;

// ─── Tracking normalizer ─────────────────────────────────────────────────────

function getDocketInfoValue(info: [string, string][], key: string): string {
  const entry = info.find(([k]) =>
    k.toLowerCase().includes(key.toLowerCase())
  );
  return entry ? entry[1] : "";
}

function normalizeTrackingResult(
  result: ITDTrackingResult
): TrackingSummary {
  const info = result.docket_info ?? [];
  const events = result.docket_events ?? [];
  const status = getDocketInfoValue(info, "Status") || "Unknown";
  const origin = getDocketInfoValue(info, "Origin") || "—";
  const destination = getDocketInfoValue(info, "Destination") || "—";
  const bookingDate = getDocketInfoValue(info, "Booking Date") || "—";

  let lastEvent: TrackingSummaryLastEvent | null = null;
  if (events.length > 0) {
    const latest = events.reduce((a, b) => {
      const atA = a.event_at ? new Date(a.event_at).getTime() : 0;
      const atB = b.event_at ? new Date(b.event_at).getTime() : 0;
      return atB > atA ? b : a;
    });
    lastEvent = {
      description: latest.event_description || "—",
      location: latest.event_location || "—",
      at: latest.event_at || "—",
    };
  }

  return {
    status,
    tracking_no: result.tracking_no || "—",
    origin,
    destination,
    booking_date: bookingDate,
    last_event: lastEvent,
    events_count: events.length,
    chargeable_weight: result.chargeable_weight || "—",
  };
}

function formatTrackingSummary(summary: TrackingSummary): string {
  const parts: string[] = [
    `Tracking ${summary.tracking_no}: Status — ${summary.status}.`,
    `Origin — ${summary.origin}, Destination — ${summary.destination}.`,
    `Booking date: ${summary.booking_date}.`,
    `Chargeable weight: ${summary.chargeable_weight} kg.`,
  ];
  if (summary.last_event) {
    parts.push(
      `Last update: ${summary.last_event.at} — ${summary.last_event.description} at ${summary.last_event.location}.`
    );
  } else {
    parts.push("Last update: No events yet.");
  }
  parts.push(`(${summary.events_count} events on record.)`);
  return parts.join(" ");
}

/** The first result as a summary, or null when ITD has nothing for it. */
function trackingSummaryOf(results: ITDTrackingResult[]): TrackingSummary | null {
  const first = results?.[0];
  if (!first || first.errors) return null;
  return normalizeTrackingResult(first);
}

// ─── Tool executors ──────────────────────────────────────────────────────────

function num(v: unknown): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : Number(v) || 0;
}

/** Normalize country names/codes to ITD-style 2-letter codes. */
function normalizeCountryToCode(input: string): string {
  const raw = input.trim();
  if (!raw) return "IN";
  const s = raw.toLowerCase().replace(/\s+/g, " ");
  const ALIAS: Record<string, string> = {
    india: "IN",
    usa: "US",
    america: "US",
    "united states": "US",
    states: "US",
    us: "US",
    uk: "GB",
    "united kingdom": "GB",
    england: "GB",
    britain: "GB",
    uae: "AE",
    dubai: "AE",
    emirates: "AE",
    canada: "CA",
    australia: "AU",
    singapore: "SG",
    germany: "DE",
    france: "FR",
  };
  if (ALIAS[s]) return ALIAS[s];
  if (s.length === 2) return s.toUpperCase();
  return raw.toUpperCase();
}

function normalizeRateRow(
  raw: unknown
): { id: string; code: string; total: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.id != null ? String(r.id) : "";
  const code =
    typeof r.code === "string"
      ? r.code
      : typeof r.internal_api_service_code === "string"
        ? r.internal_api_service_code
        : "";
  if (!id && !code) return null;
  return {
    id: id || code,
    code: code || id,
    total: num(r.total),
  };
}

function parseWeightKg(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (!s) return Number.NaN;
  if (/\b(half|0\.5)\b/.test(s) || s === "half") return 0.5;
  const lbMatch = s.match(/^([\d.]+)\s*(lb|lbs|pound|pounds)\b/);
  if (lbMatch) {
    const lb = parseFloat(lbMatch[1]);
    if (!Number.isNaN(lb) && lb > 0) return lb * 0.45359237;
  }
  const numPart = parseFloat(s.replace(/[^\d.]/g, ""));
  return Number.isNaN(numPart) ? Number.NaN : numPart;
}

export async function executeGetRates(
  args: GetRatesArgs,
  _context: SupportChatContext
): Promise<string> {
  try {
    const destRaw = String(args.destination_country ?? "").trim();
    if (!destRaw) {
      return FALLBACK_RATES_NO_DESTINATION;
    }

    const kg = parseWeightKg(String(args.weight_kg ?? ""));
    if (Number.isNaN(kg) || kg <= 0) {
      return FALLBACK_RATES_INVALID_WEIGHT;
    }

    const originCode = normalizeCountryToCode(
      String(args.origin_country ?? "").trim() || "IN"
    );
    const destinationCode = normalizeCountryToCode(destRaw);

    const bookingDate = new Date().toISOString().split("T")[0];
    const params = {
      product_code: "SPX",
      destination_code: destinationCode,
      booking_date: bookingDate,
      origin_code: originCode,
      pcs: "1",
      actual_weight: kg.toFixed(2),
    };

    const data = (await itdClient.getRates(params)) as Record<string, unknown>;
    const rawList: unknown[] = Array.isArray(data?.data)
      ? (data.data as unknown[])
      : [];

    // ITD can list the same service at the same price more than once; the
    // customer should see it once.
    const rows: { id: string; code: string; total: number }[] = [];
    const seen = new Set<string>();
    for (const item of rawList) {
      const row = normalizeRateRow(item);
      if (!row || row.total <= 0) continue;
      const key = `${row.code}|${row.total}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }

    if (rows.length === 0) {
      return FALLBACK_RATES;
    }

    rows.sort((a, b) => a.total - b.total);

    const lines = rows.map((r, i) => {
      const label = i === 0 ? `${r.code} (Best Value)` : r.code;
      return `• ${label}: ${formatInr(r.total)}`;
    });

    const note =
      "\nThis is an estimate; the final price is set when the parcel is weighed at our hub.";
    // Same rule as the Rates page: India to anywhere else books in the app.
    const cta = isBookableCorridor(originCode, destinationCode)
      ? "\nTAP_CREATE_SHIPMENT"
      : "\nTAP_CONTACT_US";

    return `${lines.join("\n")}${note}${cta}`;
  } catch {
    return FALLBACK_RATES;
  }
}

/**
 * Tracks an AWB — or, given a BOM number, answers from the order instead,
 * since an order has no tracking until its AWB exists.
 *
 * When ITD has nothing and the AWB is on one of the caller's own orders, the
 * order's own status is the answer rather than "not found": an AWB can be ours
 * before ITD shows any movement on it.
 */
export async function executeGetTrackingSummary(
  args: GetTrackingSummaryArgs,
  context: SupportChatContext
): Promise<ToolOutcome> {
  try {
    const trackingNo = String(args.tracking_no ?? "").trim();
    if (!trackingNo) return { content: FALLBACK_TRACKING_NO_INPUT };
    if (trackingNo.length > SUPPORT_TRACKING_NO_MAX_LENGTH) {
      return { content: FALLBACK_TRACKING_TOO_LONG };
    }

    // Only an explicit BOM prefix — a bare number could just as well be an AWB.
    if (/^#?\s*bom/i.test(trackingNo)) {
      return executeGetOrderStatus({ order_no: trackingNo }, context);
    }

    let summary: TrackingSummary | null = null;
    try {
      const results = await itdClient.trackShipment(
        trackingNo,
        context.itdToken ?? undefined
      );
      summary = trackingSummaryOf(results);
    } catch {
      summary = null;
    }

    if (summary) {
      return { content: `${formatTrackingSummary(summary)}\nTAP_TRACK:${trackingNo}` };
    }

    const owned = await describeOwnedOrderByAwb(trackingNo, context);
    if (owned) {
      return {
        ...owned,
        content: `The carrier shows no movement on this AWB yet. Here is the order it belongs to:\n${owned.content}`,
      };
    }
    return { content: FALLBACK_TRACKING };
  } catch {
    return { content: FALLBACK_TRACKING };
  }
}

const TOPIC_MAP: Record<string, GuidanceKey> = {
  howtogetrates: "howToGetRates",
  howtogetrate: "howToGetRates",
  rates: "howToGetRates",
  rate: "howToGetRates",
  price: "howToGetRates",
  howtotrack: "howToTrack",
  track: "howToTrack",
  tracking: "howToTrack",
  howtoship: "howToShip",
  ship: "howToShip",
  create: "howToShip",
  shipment: "howToShip",
  book: "howToShip",
  requireddocuments: "requiredDocuments",
  documents: "requiredDocuments",
  customs: "requiredDocuments",
  bookingsteps: "bookingSteps",
  steps: "bookingSteps",
  booking: "bookingSteps",
  pickup: "pickupVsDropoff",
  dropoff: "pickupVsDropoff",
  pickupvsdropoff: "pickupVsDropoff",
  counter: "pickupVsDropoff",
  payment: "paymentMethods",
  payments: "paymentMethods",
  paymentmethods: "paymentMethods",
  cod: "paymentMethods",
  awb: "orderIdVsAwb",
  orderid: "orderIdVsAwb",
  orderidvsawb: "orderIdVsAwb",
  trackingnumber: "orderIdVsAwb",
  guest: "guestBooking",
  guestbooking: "guestBooking",
  account: "guestBooking",
  kyc: "kyc",
  identity: "kyc",
  cancel: "cancellation",
  cancellation: "cancellation",
  refund: "refunds",
  refunds: "refunds",
  packaging: "packaging",
  packing: "packaging",
  weight: "weightChange",
  weightchange: "weightChange",
  reprice: "weightChange",
  general: "general",
};

export function executeGetShipmentGuidance(
  args: { topic?: string },
  _context: SupportChatContext
): string {
  try {
    const raw = String(args?.topic ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
    const key = raw ? TOPIC_MAP[raw] : undefined;
    const guidanceKey = key && key in guidance ? key : "general";
    return guidance[guidanceKey as GuidanceKey] ?? FALLBACK_GUIDANCE;
  } catch {
    return FALLBACK_GUIDANCE;
  }
}

export function executeEscalateSupport(
  _args: { reason?: string },
  _context: SupportChatContext
): string {
  try {
    return `${escalation ?? FALLBACK_ESCALATION}\nTAP_CONTACT_US`;
  } catch {
    return `${FALLBACK_ESCALATION}\nTAP_CONTACT_US`;
  }
}

// ─── Tool dispatcher ─────────────────────────────────────────────────────────

export type ToolName =
  | "get_rates"
  | "get_tracking_summary"
  | "get_shipment_guidance"
  | "escalate_support"
  | "list_my_orders"
  | "get_order_status"
  | "get_my_kyc_status"
  | "check_pickup";

export async function dispatchTool(
  toolName: string,
  args: unknown,
  context: SupportChatContext
): Promise<ToolOutcome> {
  try {
    const raw = args && typeof args === "object" ? (args as Record<string, unknown>) : {};

    switch (toolName) {
      case "get_rates": {
        const a: GetRatesArgs = {
          origin_country:
            raw.origin_country != null ? String(raw.origin_country) : undefined,
          destination_country: String(raw.destination_country ?? ""),
          weight_kg: String(raw.weight_kg ?? ""),
        };
        return { content: await executeGetRates(a, context) };
      }
      case "get_tracking_summary":
        return executeGetTrackingSummary({ tracking_no: String(raw.tracking_no ?? "") }, context);
      case "get_shipment_guidance":
        return {
          content: executeGetShipmentGuidance(
            { topic: raw.topic != null ? String(raw.topic) : undefined },
            context
          ),
        };
      case "escalate_support":
        return {
          content: executeEscalateSupport(
            { reason: raw.reason != null ? String(raw.reason) : undefined },
            context
          ),
        };
      case "list_my_orders":
      // The old name, in case a model replays a transcript that used it.
      case "get_user_shipments":
        return executeListMyOrders(context);
      case "get_order_status":
        return executeGetOrderStatus({ order_no: String(raw.order_no ?? "") }, context);
      case "get_my_kyc_status":
        return executeGetMyKycStatus(context);
      case "check_pickup":
        return executeCheckPickup({ pincode: String(raw.pincode ?? "") });
      default:
        return { content: FALLBACK_DISPATCHER };
    }
  } catch {
    return { content: FALLBACK_DISPATCHER };
  }
}

// ─── OpenAI orchestration ────────────────────────────────────────────────────

function getOpenAIClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key || typeof key !== "string" || key.trim() === "") return null;
  return new OpenAI({ apiKey: key, timeout: 30_000 });
}

const SUPPORT_SYSTEM_PROMPT = `You are BIA, the Bombino Intelligence Assistant: the in-app support assistant for Bombino Express, an Indian courier that ships parcels and documents from India to the rest of the world.

HOW BOMBINO WORKS (use this; never contradict it)
- Anyone can book in the app: with an account, or as a guest after verifying their phone with a one-time code.
- Booking creates an Order ID like BOM-100231 straight away. There is no tracking number yet.
- The parcel reaches us by doorstep pickup (in areas our riders cover, on a date the customer picks) or by drop-off at a Bombino counter.
- At our hub the parcel is weighed and the final amount is set. Then the tracking number (AWB) is issued and the parcel is dispatched. Some accounts get their AWB at booking.
- Payment: online at booking, to the rider at pickup, at the counter at drop-off, or at delivery (collected at the destination). The amount at booking is an estimate until the parcel is weighed.
- Account holders can ask to cancel from the order page before pickup or drop-off; our team decides. Guests contact support to cancel. Refunds are arranged by our team, never automatically.
- One identity document is collected once. It never holds up an order.

WHICH TOOL
- list_my_orders: "my orders", "help with my order", "where is my parcel" without an ID. Call it straight away; never ask for an ID first. List the results, then ask which one they mean.
- get_order_status: any Order ID (BOM-...), or once the user picks an order from a list. Also for "when is my pickup", "has the rider come", "how much do I pay", "why no tracking number yet" about an order. When the user names an Order ID, always call get_order_status for it, never list_my_orders.
- Cancelling: call get_order_status first. An account holder asks from the order page; a guest is cancelled by support, so also call escalate_support.
- A general question with no order named ("why don't I have a tracking number", "how does payment work") is a how-to question: answer it with get_shipment_guidance first, then offer to check their order.
- If the user names an order by destination ("my London parcel"), call list_my_orders, match it, then get_order_status. If several match, ask which.
- get_tracking_summary: an AWB or tracking number.
- check_pickup: whether pickup is available, cut-off times, or any 6-digit Indian pincode.
- get_rates: price questions. As soon as you know the destination and the weight, call get_rates. Never ask the user to confirm something they already told you. If one is missing, ask for it, one at a time. Origin defaults to India. Never ask about service type, pieces or dates.
- get_my_kyc_status: their identity document or KYC.
- get_shipment_guidance: how-to questions (topics: booking, pickup, payment, awb, guest, kyc, cancel, refund, packaging, weight, documents, rates, tracking).
- escalate_support: lost or damaged parcels, refund or compensation disputes, customs holds, complaints about a rider or a delivery, cancelling a guest order, anything you cannot answer, or when they ask for a person.

HARD RULES
- Never invent or guess an order status, tracking event, date, amount or rate. Only report what a tool returned.
- Give an order's status in the tool's words. Never use internal terms such as weighed, settled or ready for docket.
- When a tool gives a note written by our team ("Their note, to quote word for word"), quote it exactly, in quotation marks. Never explain it or add reasons of your own.
- If a tool result starts a line with "Important:", follow it.
- Never state a pickup or drop-off code, even if asked. Say where to find it, as the tool says. If the tool says nothing about a code, none has been issued yet: say so.
- You cannot change anything: you cannot cancel, reschedule, edit an address, take a payment or issue a code. Say what they can do in the app and include the button.
- You cannot contact the team for them. Never say you have escalated, forwarded, raised or passed on anything, or that someone will be in touch because of this chat. Ask them to reach our team with the WhatsApp or call buttons.
- Do not work out how much more is owed or how much will be refunded. If the amount changed, say our team will be in touch.
- Never mention tools, APIs or internal systems.

BUTTONS
- Tool results may list lines starting with TAP_ (for example TAP_VIEW_ORDER:BOM-100231). Copy the ones relevant to your answer exactly as written, each on its own line at the very end of your reply. Never invent one, never change one, never explain them, and never write the word "Buttons".
- After escalate_support, end with TAP_CONTACT_US.

DELIVERY ESTIMATES (only once an order is dispatched)
- USA / UK / Europe: 3-5 business days. UAE / Middle East / Gulf: 2-4. Asia Pacific: 3-6. Rest of world: 5-10.
- Business days are Monday to Friday. Always say "typically". Never promise a date.
- Before dispatch, say the delivery estimate starts once it leaves our hub.

LANGUAGE
- Default to English.
- If the user sends 2 or more consecutive messages clearly written in Hinglish (Hindi in Roman letters), reply in Hinglish.
- Never use Devanagari or any non-Latin script.
- If they switch back to English, switch back immediately.

STYLE
- Short, warm, direct. A few short lines is ideal. No filler.
- No markdown: no asterisks, bold, headers or tables. Plain numbered lists or hyphens.
- Use the user's first name when known.
- Listing orders: one line each, "1. BOM-100231 - To New York, United States - Arrived at Bombino hub".
- About one order: lead with its status and what happens next, in two to four sentences. Mention payment, amounts or the tracking number only when asked, or when something needs their attention. Never recite every field.
- End with one useful next step or question when it helps.`;

function buildSystemPrompt(context: SupportChatContext): string {
  const firstName = context.user?.fullName?.trim().split(/\s+/)[0] ?? "";
  const owner = ownerOf(context);

  const who =
    owner?.kind === "account"
      ? `

CURRENT USER
Signed in${firstName ? `. First name: ${firstName}` : ""}. You can look up their orders and identity document. Do not ask for their name, email or phone.`
      : owner?.kind === "guest"
        ? `

CURRENT USER
Booked as a guest and verified their phone${context.guestPhone ? ` ending ${context.guestPhone.slice(-4)}` : ""}. You can look up their guest orders and identity document. Do not ask them to log in for order questions. They have no order page: point them to My shipments.`
        : `

CURRENT USER
Not signed in. For their own orders, ask them to sign in, or, if they booked as a guest, to verify their phone on the Ship screen. Tracking an AWB, rates, pickup checks and how-to questions work without signing in.`;

  return SUPPORT_SYSTEM_PROMPT + who;
}

const SUPPORT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_my_orders",
      description:
        "List the user's most recent orders and shipments with their current status. Use when they ask about their orders without giving an Order ID or AWB.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_status",
      description:
        "Full status of one of the user's orders by Order ID (BOM-...): current status, last update, pickup or drop-off, payment, tracking number and what happens next.",
      parameters: {
        type: "object",
        properties: {
          order_no: { type: "string", description: "Order ID, e.g. BOM-100231" },
        },
        required: ["order_no"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tracking_summary",
      description: "Live tracking for an AWB / tracking number.",
      parameters: {
        type: "object",
        properties: {
          tracking_no: { type: "string", description: "AWB or tracking number" },
        },
        required: ["tracking_no"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_pickup",
      description:
        "Check whether doorstep pickup is available at an Indian pincode, its same-day cut-off, and the nearest drop-off counters if not.",
      parameters: {
        type: "object",
        properties: {
          pincode: { type: "string", description: "6-digit Indian pincode" },
        },
        required: ["pincode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_rates",
      description:
        "Get shipping rates. Ask the user where they are shipping to and the weight in kg. Nothing else.",
      parameters: {
        type: "object",
        properties: {
          origin_country: {
            type: "string",
            description: "Origin country name or code; default India",
          },
          destination_country: {
            type: "string",
            description: "Destination country name or code",
          },
          weight_kg: {
            type: "string",
            description: "Weight in kg as a number",
          },
        },
        required: ["destination_country", "weight_kg"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_kyc_status",
      description: "Whether the user's identity document (KYC) is on file and verified.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_shipment_guidance",
      description: "Pre-written answers to how-to questions about booking and shipping with Bombino.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description:
              "One of: booking, pickup, payment, awb, guest, kyc, cancel, refund, packaging, weight, documents, rates, tracking, general",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_support",
      description:
        "Show the user the buttons to reach our support team on WhatsApp or by phone. It notifies nobody: the user has to contact them. Use when they ask for a person or need help beyond what you can provide.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Optional reason for escalation" },
        },
      },
    },
  },
];

/** Quick replies offered under the reply, keyed by the last tool the turn used. */
const QUICK_REPLIES: Partial<Record<string, string[]>> = {
  get_order_status: ["Show all my orders", "How do payments work?", "Talk to a person"],
  get_tracking_summary: ["When will it arrive?", "Talk to a person"],
  get_rates: ["Is pickup available at my pincode?", "How do I book?"],
  check_pickup: ["Get a rate", "How do I book?"],
  get_my_kyc_status: ["Show my orders"],
  get_shipment_guidance: ["Show my orders", "Get a rate"],
};

/** A tool call as the model made it, reported to `HandleChatOptions.onToolCall`. */
export interface ToolCallTrace {
  name: string;
  args: unknown;
}

export interface HandleChatOptions {
  /**
   * Told about every tool call, in the order they run. The eval runner
   * (scripts/bia-eval.ts) uses it to check which tools a prompt reached; the
   * chat route passes nothing. It must not throw — an error here is swallowed.
   */
  onToolCall?: (call: ToolCallTrace) => void;
}

export async function handleChat(
  messages: ChatMessage[],
  context: SupportChatContext,
  options: HandleChatOptions = {}
): Promise<SupportChatResult> {
  const client = getOpenAIClient();
  if (!client) return { message: FALLBACK_CHAT, suggestions: [] };

  let currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(context) },
    ...messages.map((m) =>
      m.role === "user"
        ? { role: "user" as const, content: m.content }
        : { role: "assistant" as const, content: m.content }
    ),
  ];

  const owner = ownerOf(context);
  const ownedOrderNos = new Set<string>();
  let lastTool: string | null = null;
  let lastToolTokens: string[] = [];

  try {
    for (let iteration = 0; iteration < SUPPORT_CHAT_MAX_TOOL_ITERATIONS; iteration++) {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: currentMessages,
        tools: SUPPORT_TOOLS,
        tool_choice: "auto",
      });

      const message = response.choices?.[0]?.message;
      if (!message) return { message: FALLBACK_CHAT, suggestions: [] };

      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        if (typeof message.content !== "string") return { message: FALLBACK_CHAT, suggestions: [] };
        const final = await finalizeReply(message.content, {
          owner,
          ownedOrderNos,
          fallbackTokens: lastToolTokens,
        });
        // A lookup that found nothing offers no buttons; follow-ups about the
        // thing it did not find would be noise.
        const foundNothing =
          (lastTool === "get_tracking_summary" || lastTool === "get_order_status") &&
          lastToolTokens.length === 0;
        const replies = (!foundNothing && lastTool && QUICK_REPLIES[lastTool]) || [];
        return {
          message: final || FALLBACK_CHAT,
          // Nothing about "my orders" for someone we cannot look orders up for.
          suggestions: owner ? replies : replies.filter((r) => !/\bmy orders\b/i.test(r)),
        };
      }

      const assistantMsg: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: "assistant",
        content: message.content ?? null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? "" },
        })),
      };
      const toolResults: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = await Promise.all(
        toolCalls.map(async (tc) => {
          const name = tc.function?.name ?? "";
          let args: unknown = {};
          try {
            args = JSON.parse(tc.function?.arguments ?? "{}");
          } catch {
            args = {};
          }
          try {
            options.onToolCall?.({ name, args });
          } catch {
            /* a tracer never breaks a reply */
          }
          const outcome = await dispatchTool(name, args, context);
          for (const orderNo of outcome.orderNos ?? []) ownedOrderNos.add(orderNo);
          return {
            role: "tool" as const,
            tool_call_id: tc.id,
            content: outcome.content,
          };
        })
      );
      currentMessages = [...currentMessages, assistantMsg, ...toolResults];
      lastTool = toolCalls[toolCalls.length - 1]?.function?.name ?? lastTool;
      const lastResult = toolResults[toolResults.length - 1];
      lastToolTokens =
        lastResult && typeof lastResult.content === "string" ? tokensIn(lastResult.content) : [];
    }

    return { message: FALLBACK_CHAT, suggestions: [] };
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    if (msg.includes("429") || /quota|rate limit/i.test(msg)) {
      return {
        message:
          "Our AI support is temporarily at capacity. Please try again in a few minutes or contact support from the app menu.",
        suggestions: [],
      };
    }
    return { message: FALLBACK_CHAT, suggestions: [] };
  }
}
