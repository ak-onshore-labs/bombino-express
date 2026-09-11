/**
 * BIA's general tools — the ones on every screen, for everyone: rates,
 * tracking, pickup checks, the identity document on file, how-to answers, and
 * reaching our team. Moved here from supportAgent.ts (BIA 3.0, package 1.5)
 * so the agent is only the conversation loop and each module keeps its own
 * tools.
 *
 * Executors never throw and never expose internal errors: each returns a safe
 * string.
 */

import { itdClient } from "./itd.js";
import type { ITDTrackingResult } from "./itd.js";
import { guidance, escalation } from "./supportContent.js";
import type { GuidanceKey } from "./supportContent.js";
import {
  describeOwnedOrderByAwb,
  executeCheckPickup,
  executeGetMyKycStatus,
  executeGetOrderStatus,
  formatInr,
} from "./supportOrders.js";
import type {
  BiaTool,
  SupportChatContext,
  ToolOutcome,
  TrackingSummary,
  TrackingSummaryLastEvent,
} from "./supportTypes.js";
import {
  SUPPORT_TRACKING_NO_MAX_LENGTH,
  type GetRatesArgs,
  type GetTrackingSummaryArgs,
} from "./supportTypes.js";
import type { RateCard } from "../shared/biaCards.js";
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

/**
 * "United Kingdom" for GB. The code is what ITD quoted against, so it is
 * known-good by the time a card is drawn; the name never comes from the
 * model's own words.
 */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
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
): Promise<ToolOutcome> {
  try {
    const destRaw = String(args.destination_country ?? "").trim();
    if (!destRaw) {
      return { content: FALLBACK_RATES_NO_DESTINATION };
    }

    const kg = parseWeightKg(String(args.weight_kg ?? ""));
    if (Number.isNaN(kg) || kg <= 0) {
      return { content: FALLBACK_RATES_INVALID_WEIGHT };
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
      return { content: FALLBACK_RATES };
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

    const card: RateCard = {
      kind: "rate",
      destination: countryName(destinationCode),
      weightKg: Math.round(kg * 100) / 100,
      services: rows.map((r) => ({ name: r.code, amount: r.total })),
      bookable: isBookableCorridor(originCode, destinationCode),
    };

    return { content: `${lines.join("\n")}${note}${cta}`, cards: [card] };
  } catch {
    return { content: FALLBACK_RATES };
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

// ─── Registration ────────────────────────────────────────────────────────────

const str = (v: unknown): string => (v == null ? "" : String(v));

export const GENERAL_TOOLS: readonly BiaTool[] = [
  {
    module: "general",
    definition: {
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
    run: (args, context) => executeGetTrackingSummary({ tracking_no: str(args.tracking_no) }, context),
  },
  {
    module: "general",
    definition: {
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
    run: (args) => executeCheckPickup({ pincode: str(args.pincode) }),
  },
  {
    module: "general",
    definition: {
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
    run: (args, context) =>
      executeGetRates(
        {
          origin_country: args.origin_country != null ? String(args.origin_country) : undefined,
          destination_country: str(args.destination_country),
          weight_kg: str(args.weight_kg),
        },
        context
      ),
  },
  {
    module: "general",
    definition: {
      type: "function",
      function: {
        name: "get_my_kyc_status",
        description: "Whether the user's identity document (KYC) is on file and verified.",
        parameters: { type: "object", properties: {} },
      },
    },
    run: (_args, context) => executeGetMyKycStatus(context),
  },
  {
    module: "general",
    definition: {
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
    run: async (args, context) => ({
      content: executeGetShipmentGuidance({ topic: args.topic != null ? String(args.topic) : undefined }, context),
    }),
  },
  {
    module: "general",
    definition: {
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
    run: async (args, context) => ({
      content: executeEscalateSupport({ reason: args.reason != null ? String(args.reason) : undefined }, context),
    }),
  },
];
