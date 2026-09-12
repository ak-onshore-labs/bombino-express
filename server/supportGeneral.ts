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
import { findOrderForOwner } from "./ordersDb.js";
import { CASE_CATEGORIES, CASE_TOPICS, findOwnerCases, isCaseCategory, openSupportCase } from "./supportCases.js";
import {
  describeOwnedOrderByAwb,
  executeCheckPickup,
  executeGetMyKycStatus,
  executeGetOrderStatus,
  formatInr,
  normalizeOrderNo,
  ownerOf,
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
import type { CaseCard, RateCard } from "../shared/biaCards.js";
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
  account: "guestOrAccount",
  signup: "guestOrAccount",
  guestoraccount: "guestOrAccount",
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

let warnedNoCases = false;

/**
 * Hand the customer to our team. With the handoff module off (the default),
 * that means the contact buttons and nothing else: nobody is told. With it on,
 * an account or a guest gets a support case our team can see (supportCases.ts),
 * about their own order when they named one; asking again finds the case
 * already open. A signed-out visitor, or a case that can't be stored (the
 * migration not run yet), gets the buttons as before.
 */
export async function executeEscalateSupport(
  args: { reason?: unknown; order_no?: unknown; category?: unknown },
  context: SupportChatContext
): Promise<ToolOutcome> {
  const plain: ToolOutcome = { content: `${escalation ?? FALLBACK_ESCALATION}\nTAP_CONTACT_US` };
  if (!context.modules?.includes("handoff")) return plain;

  const owner = ownerOf(context);
  if (!owner) {
    return {
      content: `They aren't signed in and haven't verified a phone, so no case can be opened for them. ${plain.content}`,
    };
  }

  // The order it's about, and only if it's theirs: a case must never name
  // someone else's order.
  const named = typeof args.order_no === "string" ? normalizeOrderNo(args.order_no) : null;
  const candidate = named ?? context.screen?.orderNo ?? null;
  const owned = candidate ? await findOrderForOwner({ orderNo: candidate }, owner).catch(() => null) : null;
  const orderNo = owned ? candidate : null;
  const category = isCaseCategory(args.category) ? args.category : "other";

  try {
    const opened = await openSupportCase({
      owner,
      orderNo,
      category,
      transcript: context.transcript ?? [],
      turnId: context.turnId ?? null,
    });
    const card: CaseCard = {
      kind: "case",
      caseNo: opened.caseNo,
      status: opened.status,
      orderNo: opened.orderNo,
      topic: CASE_TOPICS[opened.category],
      existing: opened.existing,
    };
    const about = opened.orderNo ? ` for ${opened.orderNo}` : "";
    const lines = [
      opened.existing
        ? `Case ${opened.caseNo}${about} was already open from earlier, so no new one was made.`
        : `Case ${opened.caseNo}${about} is open.`,
      "Our team can see this conversation and the case. Give them the case number, and say they can message us on WhatsApp with it using the button. Never promise when the team will reply or what they'll decide, and don't say anything else was done.",
      named && !orderNo
        ? `The order they named isn't on their ${owner.kind === "guest" ? "phone number" : "account"}, so the case doesn't name an order.`
        : "",
      `TAP_CASE_WHATSAPP:${opened.caseNo}`,
    ].filter(Boolean);
    return {
      content: lines.join("\n"),
      cards: [card],
      caseNos: [opened.caseNo],
      ...(orderNo ? { orderNos: [orderNo] } : {}),
    };
  } catch (err) {
    if (!warnedNoCases) {
      warnedNoCases = true;
      console.warn(`[bia] could not open a support case: ${(err as Error).message} (has migrations/create_support_cases.sql been run?)`);
    }
    return plain;
  }
}

const CASE_STATUS_WORDS = {
  open: "open, no reply from our team yet. Never say when they'll reply",
  answered: "answered",
  closed: "closed",
} as const;

function caseDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

/**
 * Their own support cases (BIA 3.0, 4.3): "did the team reply?", or a case
 * number from the bell. Our team's reply is handed over word for word and
 * drawn in the case card; BIA adds nothing to it. Only ever the caller's own
 * cases: a number that isn't theirs reads as not found.
 */
export async function executeGetSupportCase(
  args: { case_no?: unknown },
  context: SupportChatContext
): Promise<ToolOutcome> {
  const owner = ownerOf(context);
  if (!owner) {
    return {
      content:
        "They aren't signed in and haven't verified a phone, so their cases can't be looked up. Ask them to sign in, or, if they booked as a guest, to verify their phone on the Ship screen.",
    };
  }
  const raw = typeof args.case_no === "string" ? args.case_no.trim().toUpperCase().replace(/\s+/g, "") : "";
  const digits = raw.match(/^(?:BIA-?)?([0-9]{4,7})$/);
  const caseNo = digits ? `BIA-${digits[1]}` : null;
  const where = owner.kind === "guest" ? "phone number" : "account";

  let cases;
  try {
    cases = await findOwnerCases(owner, caseNo);
  } catch {
    return { content: `Their cases can't be looked up right now. Ask them to message our team on WhatsApp${caseNo ? ` with ${caseNo}` : ""}.\nTAP_CONTACT_US` };
  }
  if (cases.length === 0) {
    return {
      content: caseNo
        ? `There is no case ${caseNo} on their ${where}. Never guess its status.\nTAP_CONTACT_US`
        : `They have no support cases on their ${where}.`,
    };
  }

  const lines = cases.map((c) => {
    const about = [CASE_TOPICS[c.category], c.orderNo].filter(Boolean).join(", ");
    const reply = c.reply ? ` Our team's reply, to quote word for word: "${c.reply}"` : "";
    return `Case ${c.caseNo} (${about}), opened ${caseDay(c.createdAt)}: ${CASE_STATUS_WORDS[c.status]}.${reply}`;
  });
  const latest = cases[0];
  lines.push(
    "Important: the case card under your reply shows our team's reply. Give it in a sentence or two; never add to it, explain it, or promise anything it doesn't say."
  );
  if (latest.status !== "closed") lines.push(`TAP_CASE_WHATSAPP:${latest.caseNo}`);

  const cards: CaseCard[] = cases.map((c) => ({
    kind: "case",
    caseNo: c.caseNo,
    status: c.status,
    orderNo: c.orderNo,
    topic: CASE_TOPICS[c.category],
    existing: true,
    reply: c.reply,
  }));
  return { content: lines.join("\n"), cards, caseNos: cases.map((c) => c.caseNo) };
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
                "One of: booking, pickup, payment, awb, guest, account, kyc, cancel, refund, packaging, weight, documents, rates, tracking, general",
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
          "Show the user the buttons to reach our support team on WhatsApp or by phone. For a signed-in or verified customer it may also open a case our team can see: its answer says which. Use when they ask for a person or need help beyond what you can provide.",
        parameters: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Optional reason for escalation" },
            order_no: { type: "string", description: "The Order ID it's about, if they gave one." },
            category: { type: "string", enum: [...CASE_CATEGORIES], description: "What it's about." },
          },
        },
      },
    },
    run: (args, context) => executeEscalateSupport(args, context),
  },
];

/** The handoff module's own tool: offered only while cases are switched on. */
export const CASE_TOOLS: readonly BiaTool[] = [
  {
    module: "handoff",
    definition: {
      type: "function",
      function: {
        name: "get_support_case",
        description:
          "The customer's own support cases and our team's reply: when they ask about a case, give a case number (BIA-...), or ask whether the team has replied.",
        parameters: {
          type: "object",
          properties: {
            case_no: { type: "string", description: "The case number, e.g. BIA-1002, if they gave one." },
          },
        },
      },
    },
    run: (args, context) => executeGetSupportCase(args, context),
  },
];
