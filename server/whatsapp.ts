/**
 * The WhatsApp transport — the only file that knows about HTTP or about Tata.
 *
 * Provider is Tata Tele Omni's WhatsApp BSP, which fronts the Meta Cloud API.
 * The bearer token identifies the WABA (its JWT carries the botId), so there is
 * no sender number to configure: the account the token belongs to is the sender.
 *
 * THE CONTRACT: nothing in this file throws, and nothing in it can fail an
 * action. A parcel moves whether or not WhatsApp is reachable. Every path
 * returns, and every failure is a row in `whatsapp_messages` rather than an
 * exception travelling up into a lifecycle handler.
 *
 * EVERY MESSAGE IS A TEMPLATE. Free-form text is only legal inside a 24-hour
 * window opened by an inbound customer message, and we are send-only, so that
 * window never exists. A template not approved in the Omni panel does not send
 * — the API rejects it, which is what the `failed` rows are for.
 */

import {
  claimMessage,
  markNotSent,
  markSent,
  getWhatsappRecipient,
  getWhatsappReachability,
} from "./whatsappDb.js";
import { WA_TEMPLATE } from "./whatsappTemplates.js";

const DEFAULT_BASE_URL = "https://wb.omni.tatatelebusiness.com";
const SEND_PATH = "/whatsapp-cloud/messages";
const TIMEOUT_MS = 8_000;
const LANGUAGE_CODE = "en";

/**
 * Dry run logs the rendered message and writes the row, but sends nothing.
 *
 * Defaults ON in development. A developer clicking through the pickup flow
 * against the shared Supabase project would otherwise put real messages on
 * whatever numbers happen to be seeded in it.
 */
function isDryRun(): boolean {
  const explicit = process.env.WA_DRY_RUN;
  if (explicit === "1") return true;
  if (explicit === "0") return false;
  return process.env.NODE_ENV === "development";
}

function baseUrl(): string {
  return (process.env.TATA_WA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

let missingTokenLogged = false;
function token(): string | null {
  const value = process.env.TATA_WA_TOKEN;
  if (!value) {
    if (!missingTokenLogged) {
      missingTokenLogged = true;
      console.warn(
        "[whatsapp] TATA_WA_TOKEN is not set — no WhatsApp messages will be sent. " +
          "In-app notifications are unaffected."
      );
    }
    return null;
  }
  return value;
}

/**
 * A stored phone number as WhatsApp wants it: E.164 digits, no plus.
 *
 * The DB holds bare 10-digit Indian numbers (`phoneSchema`, routes.ts) but
 * `addresses.phone` is validated far more loosely and older rows carry spaces,
 * `+91` prefixes and hyphens. Returns null rather than guessing at anything
 * that is not recognisably an Indian mobile — a message sent to a mangled
 * number is charged for and lands nowhere.
 */
export function toWaMsisdn(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  // A leading zero is how a pasted mobile number often arrives.
  if (/^0[6-9]\d{9}$/.test(digits)) return `91${digits.slice(1)}`;
  return null;
}

export type SendOutcome =
  | { ok: true; messageId: string | null }
  | {
      ok: false;
      reason: "duplicate" | "no_number" | "opted_out" | "not_on_whatsapp" | "skipped" | "failed";
    };

export interface SendTemplateInput {
  /** Phone as stored. Normalised here; a number that will not normalise is refused. */
  to: string | null | undefined;
  template: string;
  /** Body variables, in the order the approved template declares them. */
  variables: string[];
  /**
   * The idempotency key. Two sends with the same key are the same message and
   * the second one does not happen. See migrations/create_whatsapp_messages.sql.
   */
  dedupeKey: string;
  orderId?: string | null;
  userId?: string | null;
  /** Set for authentication templates — Meta requires the code on the button too. */
  otpButtonCode?: string;
  /**
   * Store a placeholder instead of the real variables.
   *
   * For anything that is a credential. `otp_codes` deliberately stores only a
   * hash of the login code; writing the plaintext into `whatsapp_messages.variables`
   * would undo that and leave every code ever sent sitting in a table next to
   * the number it belongs to. The provider still receives the real values.
   */
  redactVariables?: boolean;
  /**
   * Send even to a number last seen as not on WhatsApp.
   *
   * For the login code and the profile "Verify WhatsApp" code only. Those sends
   * are how a number gets re-checked; skipping them would mark a customer
   * unreachable for good the first time they signed in without WhatsApp.
   */
  skipReachabilityCheck?: boolean;
}

/**
 * Send one approved template.
 *
 * Order of operations matters and is not negotiable: claim the row, then send.
 * The claim is the only thing standing between a retried action and a customer
 * receiving the same message twice, and a claim taken after a successful send
 * would not stop anything.
 */
export async function sendTemplate(input: SendTemplateInput): Promise<SendOutcome> {
  const to = toWaMsisdn(input.to);
  if (!to) {
    // Not worth a row: there is no number, so there was never a message.
    // Logged because a customer with no usable phone is a data problem
    // somebody should see.
    console.warn("[whatsapp] no usable number for template", {
      template: input.template,
      order_id: input.orderId ?? null,
    });
    return { ok: false, reason: "no_number" };
  }

  if (input.userId) {
    const recipient = await getWhatsappRecipient(input.userId);
    if (recipient?.optedOut) return { ok: false, reason: "opted_out" };
  }

  // A number Meta has told us has no WhatsApp. Sending would be charged for
  // and land nowhere; the customer still gets the in-app notification. No row
  // is claimed, same as `no_number`: there was never a message.
  if (!input.skipReachabilityCheck) {
    const reach = await getWhatsappReachability(to, WA_TEMPLATE.loginOtp);
    if (reach === "not_on_whatsapp") return { ok: false, reason: "not_on_whatsapp" };
  }

  const claim = await claimMessage({
    orderId: input.orderId ?? null,
    userId: input.userId ?? null,
    toPhone: to,
    template: input.template,
    variables: input.redactVariables ? ["[redacted]"] : input.variables,
    dedupeKey: input.dedupeKey,
  });

  if (!claim.ok) {
    // "duplicate" is the mechanism working. "error" means we could not record
    // the send, and an unrecordable send is one we cannot dedupe or explain
    // afterwards, so it does not happen.
    if (claim.reason === "error") {
      console.error("[whatsapp] could not claim a message row; not sending", {
        template: input.template,
        dedupe_key: input.dedupeKey,
      });
    }
    return { ok: false, reason: claim.reason === "duplicate" ? "duplicate" : "failed" };
  }

  const bearer = token();
  if (!bearer || isDryRun()) {
    const why = !bearer ? "no_token" : "dry_run";
    const rendered = input.redactVariables ? "[redacted]" : input.variables.join(" | ");
    console.log(`[whatsapp] (${why}) → ${to} ${input.template} [${rendered}]`);
    await markNotSent(claim.id, "skipped", { why });
    return { ok: false, reason: "skipped" };
  }

  const result = await postTemplate({
    bearer,
    to,
    template: input.template,
    variables: input.variables,
    otpButtonCode: input.otpButtonCode,
    // Round-trip our row id. It comes back on every delivery receipt as
    // `statuses[].custom_callback_data`, and it is the ONLY thing that can
    // match a receipt to the message that caused it — see `applyDeliveryReceipt`.
    //
    // The row id and not the dedupe key: the key carries a phone number, and
    // for a handover message the four-digit code as well. Neither belongs in a
    // field that travels out to Meta and back.
    callbackData: claim.id,
  });

  if (!result.ok) {
    await markNotSent(claim.id, "failed", result.error);
    console.error("[whatsapp] send failed", {
      template: input.template,
      order_id: input.orderId ?? null,
      error: result.error,
    });
    return { ok: false, reason: "failed" };
  }

  await markSent(claim.id, result.requestId);
  return { ok: true, messageId: result.requestId };
}

// ── HTTP ──────────────────────────────────────────────────────────────────

type PostResult =
  | { ok: true; requestId: string | null }
  | { ok: false; error: Record<string, unknown> };

function buildComponents(
  variables: string[],
  otpButtonCode: string | undefined
): unknown[] {
  const components: unknown[] = [];

  if (variables.length > 0) {
    components.push({
      type: "body",
      parameters: variables.map((text) => ({ type: "text", text })),
    });
  }

  // Authentication templates carry the code twice — once in the body and once
  // on the copy-code button. Meta rejects the message if the button parameter
  // is missing, so this is not optional decoration.
  //
  // Shape copied verbatim from Tata's "Authentication Template" send example:
  // lowercase `sub_type`, and `index` as the STRING "0". Their URL-button
  // example uses uppercase and a number instead, so both are evidently
  // accepted — but the authentication example is the one this path is.
  if (otpButtonCode) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: otpButtonCode }],
    });
  }

  return components;
}

async function postTemplate(input: {
  bearer: string;
  to: string;
  template: string;
  variables: string[];
  otpButtonCode: string | undefined;
  callbackData: string;
}): Promise<PostResult> {
  const body = {
    to: input.to,
    type: "template",
    // Tata's own field: marks the call as originating outside the Omni agent
    // console, which is what keeps these off a human agent's queue.
    source: "external",
    template: {
      name: input.template,
      language: { code: LANGUAGE_CODE },
      components: buildComponents(input.variables, input.otpButtonCode),
    },
    metaData: { custom_callback_data: input.callbackData },
  };

  // One retry, and only on the failures a retry can fix. A 4xx is a rejected
  // template or a bad number and will be rejected identically a second time;
  // retrying it only spends the rate limit.
  let last: PostResult = {
    ok: false,
    error: { message: "no attempt was made", retryable: false },
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    last = await postOnce(input.bearer, body);
    if (last.ok) return last;
    if (!last.error.retryable) return last;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Carry the real reason into the row. "Retries exhausted" on its own tells
  // whoever reads `whatsapp_messages.error` that it failed twice and nothing
  // about why, which is the question they opened the table to answer.
  return {
    ok: false,
    error: { ...(last.ok ? {} : last.error), attempts: 2, retriesExhausted: true },
  };
}

async function postOnce(bearer: string, body: unknown): Promise<PostResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl()}${SEND_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        error: {
          status: response.status,
          // Truncated: provider errors can carry a full HTML error page, and
          // this lands in a jsonb column somebody has to read.
          body: text.slice(0, 500),
          retryable: response.status >= 500,
        },
      };
    }

    return { ok: true, requestId: extractRequestId(text) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Timeouts and DNS failures are exactly what the one retry is for.
    return { ok: false, error: { message, retryable: true } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dig the request id out of the send response.
 *
 * Documented as `{"id": "<uuid>"}` — "Request id of the API call". IT IS NOT A
 * `wamid` AND RECEIPTS CANNOT BE MATCHED WITH IT; that is what
 * `custom_callback_data` is for. This is kept only so a message that never
 * arrives has a reference Tata support can look up.
 *
 * Still reads the Cloud API's `messages[0].id` shape as a fallback, in case the
 * wrapper is ever changed to pass Meta's response through untouched.
 */
function extractRequestId(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const messages = parsed.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const first = messages[0] as Record<string, unknown>;
      if (typeof first?.id === "string") return first.id;
    }
    if (typeof parsed.id === "string") return parsed.id;
    if (typeof parsed.messageId === "string") return parsed.messageId;
    return null;
  } catch {
    return null;
  }
}
