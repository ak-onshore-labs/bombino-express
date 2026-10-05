/**
 * The WhatsApp webhook — delivery receipts, the STOP/START words, and (with
 * WHATSAPP_BIA=1) every other inbound message, answered by BIA.
 *
 * Registered in the Tata Omni panel as
 *   {PUBLIC_URL}/api/whatsapp/webhook/{TATA_WA_WEBHOOK_SECRET}
 * The secret in the path is the entire authentication, which is why it is
 * compared in constant time and why a mismatch returns 404 rather than 403: an
 * endpoint that answers "wrong secret" is an endpoint that confirms it exists.
 *
 * ALWAYS 2xx ON ANY BODY THAT PARSES — a shape we do not recognise, a receipt
 * for a message we never sent, a handler that throws. A BSP that receives a
 * non-2xx retries, and a retry storm caused by our own parse bug is worse than
 * a dropped receipt: receipts are diagnostics, and no money or parcel depends
 * on one. The only thing this endpoint can lose by failing is our visibility.
 *
 * The one exception is outside this file: a body that is not valid JSON at all
 * is rejected with 400 by `express.json()` before the route runs. Left alone
 * deliberately — catching it would mean an error handler mounted on this path
 * that answers before the secret is checked, which would tell an unauthenticated
 * caller the endpoint exists. The 404 above is worth more than a 200 on a body
 * no real provider sends.
 */

import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { applyDeliveryReceipt, setWhatsappOptOut, type WhatsappStatus } from "../whatsappDb.js";
import { toWaMsisdn } from "../whatsapp.js";
import { handleWhatsappBiaMessage, isWhatsappBiaEnabled } from "../whatsappBia.js";

/**
 * What the customer said: typed text, or the id of a button or list row they
 * tapped (BIA's quick replies carry the question in the id), or a template
 * button's text. Null for media, location, reactions and anything else.
 */
export function inboundMessageText(message: Record<string, unknown>): string | null {
  const text = (message.text as { body?: unknown } | undefined)?.body;
  if (typeof text === "string" && text.trim()) return text.trim();
  const interactive = message.interactive as
    | { button_reply?: { id?: unknown; title?: unknown }; list_reply?: { id?: unknown; title?: unknown } }
    | undefined;
  const reply = interactive?.button_reply ?? interactive?.list_reply;
  const picked = reply?.id ?? reply?.title;
  if (typeof picked === "string" && picked.trim()) return picked.trim();
  const button = (message.button as { text?: unknown } | undefined)?.text;
  if (typeof button === "string" && button.trim()) return button.trim();
  return null;
}

/**
 * Timing-safe secret comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, so lengths are checked first —
 * which does leak the length, and does not matter: the secret is 48 hex
 * characters and its length is in the URL registered with the provider anyway.
 */
function secretMatches(candidate: string): boolean {
  const expected = process.env.TATA_WA_WEBHOOK_SECRET;
  if (!expected) return false;
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

/** Meta's status vocabulary, narrowed to what we store. */
function toStoredStatus(raw: unknown): WhatsappStatus | null {
  switch (raw) {
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
      return "read";
    case "failed":
      return "failed";
    default:
      // `accepted`, `deleted` and anything the BSP invents. Nothing to record.
      return null;
  }
}

/**
 * The word that has to work.
 *
 * India requires honouring an opt-out, and without this the only exit a
 * customer has is blocking the number — which counts against the sender
 * quality rating and takes every other Bombino message down with it.
 *
 * Deliberately narrow. This is not a command parser: two-way messaging is out
 * of scope, and anything that is not an unsubscribe is ignored in silence.
 */
const STOP_WORDS = new Set(["stop", "unsubscribe", "opt out", "optout"]);
const START_WORDS = new Set(["start", "resume", "subscribe"]);

type MessageIntent = "stop" | "start" | null;

function readIntent(text: unknown): MessageIntent {
  if (typeof text !== "string") return null;
  const normalised = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (STOP_WORDS.has(normalised)) return "stop";
  if (START_WORDS.has(normalised)) return "start";
  return null;
}

/**
 * Walk whatever shape arrived and pull out the two things we act on.
 *
 * Meta nests everything under `entry[].changes[].value`; BSP wrappers often
 * flatten one or both of those away. Rather than committing to one shape, this
 * collects `statuses` and `messages` from wherever they turn up — which also
 * means a wrapper change does not silently stop receipts landing.
 */
type Extracted = {
  statuses: Record<string, unknown>[];
  messages: Record<string, unknown>[];
};

function extract(payload: unknown, depth = 0): Extracted {
  const out: Extracted = { statuses: [], messages: [] };
  if (depth > 6 || !payload || typeof payload !== "object") return out;

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = extract(item, depth + 1);
      out.statuses.push(...nested.statuses);
      out.messages.push(...nested.messages);
    }
    return out;
  }

  const record = payload as Record<string, unknown>;

  if (Array.isArray(record.statuses)) {
    out.statuses.push(
      ...(record.statuses.filter((s) => s && typeof s === "object") as Record<string, unknown>[])
    );
  }

  // `messages` arrives as a bare OBJECT on Tata's inbound webhook, not the
  // array Meta's own format uses. Both are accepted here — reading only the
  // array shape is why the STOP word silently never registered.
  if (Array.isArray(record.messages)) {
    out.messages.push(
      ...(record.messages.filter((m) => m && typeof m === "object") as Record<string, unknown>[])
    );
  } else if (record.messages && typeof record.messages === "object") {
    out.messages.push(record.messages as Record<string, unknown>);
  }

  for (const key of ["entry", "changes", "value", "data", "payload"]) {
    if (record[key]) {
      const nested = extract(record[key], depth + 1);
      out.statuses.push(...nested.statuses);
      out.messages.push(...nested.messages);
    }
  }

  return out;
}

function readErrors(status: Record<string, unknown>): Record<string, unknown> | null {
  const errors = status.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  return { errors: errors.slice(0, 3) };
}

export function registerWhatsappRoutes(app: Express): void {
  app.post("/api/whatsapp/webhook/:secret", async (req: Request, res: Response) => {
    if (!secretMatches(req.params.secret ?? "")) {
      res.status(404).json({ message: "Not found" });
      return;
    }

    // Answer first, work second. The provider's timeout is short, and nothing
    // below can change what we tell it.
    res.json({ received: true });

    try {
      const { statuses, messages } = extract(req.body);

      for (const status of statuses) {
        const stored = toStoredStatus(status.status);
        if (!stored) continue;

        // `custom_callback_data` is our own row id, sent with the message and
        // handed back here. It is the only usable match: the id returned when
        // we sent is Tata's request id, while `status.id` is a Meta `wamid`,
        // and nothing links the two.
        const rowId =
          typeof status.custom_callback_data === "string" &&
          status.custom_callback_data.trim() !== ""
            ? status.custom_callback_data
            : null;
        const providerId = typeof status.id === "string" ? status.id : null;
        if (!rowId && !providerId) continue;

        await applyDeliveryReceipt({
          rowId,
          providerId,
          status: stored,
          error: readErrors(status),
        });
      }

      for (const message of messages) {
        const body = (message.text as Record<string, unknown> | undefined)?.body;
        const intent = readIntent(body);
        if (!intent) {
          // Everything that is not STOP/START is a question for BIA, when
          // WhatsApp BIA is switched on here (server/whatsappBia.ts).
          const text = inboundMessageText(message);
          const from = typeof message.from === "string" ? message.from : null;
          const id = typeof message.id === "string" ? message.id : null;
          if (text && from && id && isWhatsappBiaEnabled()) {
            void handleWhatsappBiaMessage({ from, messageId: id, text });
          }
          continue;
        }

        // The account is keyed on the bare 10-digit number; the webhook carries
        // E.164. Normalising the inbound number the same way the send path does
        // keeps the two ends of this agreeing.
        const from = typeof message.from === "string" ? message.from : null;
        const msisdn = toWaMsisdn(from);
        if (!msisdn) continue;
        const local = msisdn.startsWith("91") ? msisdn.slice(2) : msisdn;

        const written = await setWhatsappOptOut(local, intent === "stop");
        console.log("[whatsapp] inbound opt-out instruction", {
          intent,
          matched_account: written,
        });
      }
    } catch (error) {
      // The provider has already been told 200. This is our problem, not theirs.
      console.error("[whatsapp] webhook processing failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
