/**
 * ── Filing a real ITD docket ────────────────────────────────────────────────
 *
 * The one path every real AWB goes through: at booking, on an automatic retry,
 * and when ops presses Retry AWB or Generate docket. Before this, a docket that
 * failed at booking was never filed again: the only ops action left was a
 * mock AWB.
 *
 * In order, and each step exists because a real order failed at it:
 *
 *   1. One filer at a time (`acquireDocketLock`). ITD has no idempotency key
 *      and permits no amendment; two filings are two shipments.
 *   2. An identity document on file (`kycForOrder`).
 *   3. The booking complete enough to be accepted (`docketProblems`): a short
 *      US ZIP, a missing state, goods booked as Documents (BOM-100305, 100307).
 *   4. ITD can price it (`itdRateLookup`). A shipment ITD cannot price is
 *      refused at create_docket as "Freight amount is 0"; asking the rates
 *      endpoint first costs nothing and files nothing.
 *   5. A working token, minted from the customer's stored ITD login without
 *      needing their browser session, and re-minted once if ITD says it has
 *      expired (BOM-100134).
 *   6. The filing, with a 15 s answer for whoever is waiting, and up to two
 *      minutes more listening in the background for an answer that comes late
 *      (BOM-100330, 100331). Late AWBs are saved, not dropped.
 *
 * Every failure is written to `metadata.docket_error` with who acts next
 * (shared/docketRules.ts): the retry sweep, ops after a correction, or a person
 * checking ITD's portal first. The customer is never shown any of it
 * (shared/docketError.ts `customerNote`).
 */

import crypto from "crypto";

import { buildItdKycPayload } from "../shared/kyc.js";
import { classifyDocketFailure, docketProblems, DOCKET_AUTO_ATTEMPTS, type DocketRetry } from "../shared/docketRules.js";
import type { Order } from "../shared/orderContract.js";
import { itdClient, isItdAuthExpired, type CreateShipmentPayload, type CreateShipmentResponse } from "./itd.js";
import { withTimeout, itdTokenExpiryIso } from "./itdTokenRefresh.js";
import { decryptPassword } from "./crypto.js";
import { supabase } from "./supabaseClient.js";
import { itdUserHasStoredPassword, updateItdUserTokenById } from "./appDb.js";
import {
  acquireDocketLock,
  applyBookingDocket,
  clearBookingDocketError,
  insertOrderEvent,
  listOrdersForDocketRetry,
  recordBookingDocketError,
  releaseDocketLock,
  type OrderRow,
} from "./ordersDb.js";
import { getAddressCityPincode } from "./opsDb.js";
import { itdRateLookup, itdRatesLoginFor } from "./opsActions.js";
import { persistShipmentAfterCreate } from "./persistShipment.js";
import { kycForOrder } from "./kycPolicy.js";

/** What the person waiting (the booking screen, an ops click) waits for. */
const ANSWER_WAIT_MS = 15_000;
/** How long a slow ITD answer is still listened for after that. */
const LATE_ANSWER_WAIT_MS = 2 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 12_000;

export type DocketSource = "booking" | "auto_retry" | "ops_retry" | "ops_generate";

export type FileDocketResult =
  | { status: "issued"; awb_no: string; order: OrderRow }
  | { status: "failed"; stage: string; retry: DocketRetry; message: string; problems?: string[] }
  /** Someone else is filing this order right now. */
  | { status: "busy" }
  /** No ITD login of the customer's own to file under (guests, OTP signups). */
  | { status: "no_login" };

/**
 * Whether this server files real ITD dockets at all: `ITD_DOCKET_AT_BOOKING`,
 * on by default in production builds and off elsewhere (see
 * docketAtBooking.ts). There is no ITD sandbox and local servers share the
 * production database, so off means off for every path here: booking, the
 * retry sweep and the ops actions.
 */
export function isRealDocketFilingEnabled(): boolean {
  const flag = process.env.ITD_DOCKET_AT_BOOKING?.trim();
  if (flag === "1") return true;
  if (flag === "0") return false;
  return process.env.NODE_ENV === "production";
}

// ── Token ──────────────────────────────────────────────────────────────────

/**
 * A token for the customer's own ITD account, from their stored login.
 *
 * `fresh` skips the stored token: used after ITD has said the one we sent is
 * dead. ITD's login carries no expiry, so the stored expiry is a guess and a
 * refusal is the only reliable signal (see docketAtBooking's history).
 */
export async function itdTokenForUser(userId: string, opts: { fresh?: boolean } = {}): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("itd_users")
    .select("email, itd_token, itd_token_expires_at, itd_password_encrypted, encryption_iv")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;

  if (!opts.fresh && typeof data.itd_token === "string" && data.itd_token) {
    const exp = typeof data.itd_token_expires_at === "string" ? Date.parse(data.itd_token_expires_at) : NaN;
    if (Number.isFinite(exp) && exp > Date.now()) return data.itd_token;
  }

  if (!data.email || !data.itd_password_encrypted || !data.encryption_iv) return null;
  try {
    const password = decryptPassword(data.itd_password_encrypted as string, data.encryption_iv as string);
    const { token } = await withTimeout(
      itdClient.loginUser(data.email as string, password),
      LOGIN_TIMEOUT_MS,
      "ITD loginUser (docket)"
    );
    await updateItdUserTokenById(userId, token, itdTokenExpiryIso());
    return token;
  } catch (err) {
    console.error("[docketFiling] ITD login failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Filing ─────────────────────────────────────────────────────────────────

async function fail(
  order: Order,
  detail: { stage: string; retry: DocketRetry; message: string; problems?: string[] }
): Promise<FileDocketResult> {
  console.error(`[docketFiling] ${order.order_no} ${detail.stage} (${detail.retry}): ${detail.message}`);
  await recordBookingDocketError(order.id, detail);
  return { status: "failed", ...detail };
}

const EVENT_NOTE: Record<DocketSource | "late", string> = {
  booking: "Docket filed at booking",
  auto_retry: "AWB issued on automatic retry",
  ops_retry: "AWB issued on retry",
  ops_generate: "Docket filed",
  late: "AWB arrived late from ITD",
};

async function finalize(input: {
  order: Order;
  awb: string;
  response: CreateShipmentResponse;
  payload: CreateShipmentPayload;
  note: string;
  writeEvent: boolean;
  actorUserId: string | null;
  ip?: string;
}): Promise<FileDocketResult> {
  const { order, awb } = input;
  // Status untouched: the parcel still has to be collected, weighed and paid
  // for. `awb_no IS NULL` in the update is the last guard against a double.
  const docketed = await applyBookingDocket({ orderId: order.id, awbNo: awb, docketResponse: input.response });
  if (!docketed) {
    return fail(order, {
      stage: "persist",
      retry: "check_itd",
      message: `ITD issued AWB ${awb} but it could not be saved against this order. Attach it by hand; do not file again.`,
    });
  }
  await clearBookingDocketError(order.id);

  if (input.writeEvent) {
    void insertOrderEvent({
      order_id: order.id,
      status: docketed.status,
      note: `${input.note} · AWB ${awb}`,
      actor_user_id: input.actorUserId,
      metadata: { action: "docket_filed", awb_no: awb },
    });
  }

  // The `shipments` row and its addresses, so tracking and the documents
  // endpoint have something to read. Not a dispatch: the parcel is still here.
  if (order.user_id) {
    void persistShipmentAfterCreate(order.user_id, input.payload, input.response, input.ip, {
      notifyDispatch: false,
    });
  }
  return { status: "issued", awb_no: awb, order: docketed };
}

/**
 * File this order's docket on the customer's own ITD account.
 *
 * Never throws. `writeEvent: false` for the ops actions, whose endpoint writes
 * the order event itself.
 */
export async function fileDocket(
  order: Order,
  opts: {
    source: DocketSource;
    actorUserId: string | null;
    /** A token the caller already holds (the booking request's session). */
    sessionToken?: string | null;
    /** Told about a token minted here, so the caller can keep it. */
    onToken?: (token: string) => void;
    ip?: string;
    writeEvent?: boolean;
  }
): Promise<FileDocketResult> {
  const writeEvent = opts.writeEvent ?? true;
  if (!isRealDocketFilingEnabled()) {
    // Not recorded on the order: nothing failed, this server just may not file.
    return {
      status: "failed",
      stage: "disabled",
      retry: "ops",
      message: "Real ITD filing is switched off on this server (ITD_DOCKET_AT_BOOKING). Nothing was filed.",
    };
  }
  if (order.awb_no) return { status: "busy" };
  if (!order.user_id || !(await itdUserHasStoredPassword(order.user_id))) return { status: "no_login" };
  const userId = order.user_id;

  const holder = `${opts.source}:${crypto.randomUUID()}`;
  if (!(await acquireDocketLock(order.id, holder))) return { status: "busy" };

  // Released in `finally` unless a late answer is still being waited for, in
  // which case the background listener owns it.
  let lockHandedOff = false;
  try {
    const kyc = await kycForOrder(order);
    if (!kyc) {
      return await fail(order, {
        stage: "kyc",
        retry: "auto",
        message: "No identity document on file to send with the docket. Filed automatically once the customer adds one.",
      });
    }

    const payload = { ...(order.items as Record<string, unknown>) } as unknown as CreateShipmentPayload;
    const kycPayload = buildItdKycPayload(
      { document_type: kyc.document_type, document_no: kyc.document_no, capability_id: kyc.capability_id },
      process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 5000}`
    );
    payload.kyc_details = kycPayload.kyc_details;
    payload.shipper_gstin_type = kycPayload.shipper_gstin_type;
    payload.shipper_gstin_no = kycPayload.shipper_gstin_no;

    const problems = docketProblems(payload);
    if (problems.length) {
      return await fail(order, {
        stage: "precheck",
        retry: "ops",
        message: "The booking is missing details ITD needs. Correct them, then retry.",
        problems,
      });
    }

    const origin = order.origin_address_id ? await getAddressCityPincode(order.origin_address_id) : null;
    const rate = await itdRateLookup(
      { items: order.items, consignee: order.consignee, origin, login: await itdRatesLoginFor(userId) },
      Number(payload.actual_weight)
    );
    if (rate.status === "unpriced") {
      return await fail(order, {
        stage: "unpriced",
        retry: "ops",
        message: "ITD has no price for this shipment as booked, so it would refuse the docket (\"Freight amount is 0\").",
        problems: [
          "Check the receiver's ZIP / postal code and city against the country",
          "Check the product type: Documents (DOX) is paper only, goods are Package (SPX)",
          "Check the chosen service is offered to this destination",
        ],
      });
    }
    // "unknown" (ITD's rate endpoint did not answer) says nothing about the
    // shipment, so the filing goes ahead.

    let token = opts.sessionToken ?? (await itdTokenForUser(userId));
    if (!token) {
      return await fail(order, {
        stage: "token",
        retry: "auto",
        message: "Could not sign in to the customer's ITD account. Their ITD password may have changed.",
      });
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const call = itdClient.createShipment(payload, token);
      let response: CreateShipmentResponse;
      try {
        response = await withTimeout(call, ANSWER_WAIT_MS, "ITD create_docket");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (/timed out/i.test(message)) {
          // ITD may still be working on it. Keep listening, and keep the lock
          // so nothing files it again meanwhile.
          // The note is written first, so a late AWB that lands quickly
          // clears it rather than being overwritten by it.
          lockHandedOff = true;
          const noted = await fail(order, {
            stage: "timeout",
            retry: "check_itd",
            message: "ITD did not answer within 15 seconds. Still listening for a late answer for 2 minutes.",
          });
          void awaitLateAnswer({ order, call, payload, actorUserId: opts.actorUserId, ip: opts.ip });
          return noted;
        }

        if (attempt === 0 && isItdAuthExpired(message)) {
          const fresh = await itdTokenForUser(userId, { fresh: true });
          if (fresh) {
            token = fresh;
            opts.onToken?.(fresh);
            console.log(`[docketFiling] ${order.order_no}: ITD token had expired, retrying with a fresh one`);
            continue;
          }
        }
        return await fail(order, { ...classifyDocketFailure(message), message });
      }

      if (!response.success || !response.data?.awb_no) {
        const message = response.errors?.join("; ") || "ITD returned no airway bill number.";
        return await fail(order, {
          stage: "create_docket",
          retry: response.errors?.length ? "ops" : "check_itd",
          message,
        });
      }

      return await finalize({
        order,
        awb: response.data.awb_no,
        response,
        payload,
        note: EVENT_NOTE[opts.source],
        writeEvent,
        actorUserId: opts.actorUserId,
        ip: opts.ip,
      });
    }
    return await fail(order, { stage: "token", retry: "auto", message: "ITD kept refusing the login token." });
  } catch (err) {
    return await fail(order, {
      stage: "create_docket",
      retry: "check_itd",
      message: err instanceof Error ? err.message : "Filing failed unexpectedly.",
    });
  } finally {
    if (!lockHandedOff) await releaseDocketLock(order.id);
  }
}

/**
 * The tail of a slow filing. The ITD request was never cancelled (fetch has no
 * abort here), so its answer still arrives; this is what hears it.
 */
async function awaitLateAnswer(input: {
  order: Order;
  call: Promise<CreateShipmentResponse>;
  payload: CreateShipmentPayload;
  actorUserId: string | null;
  ip?: string;
}): Promise<void> {
  const { order } = input;
  try {
    const response = await withTimeout(input.call, LATE_ANSWER_WAIT_MS, "ITD create_docket (late)");
    if (response.success && response.data?.awb_no) {
      console.log(`[docketFiling] ${order.order_no}: late AWB ${response.data.awb_no} saved`);
      await finalize({
        order,
        awb: response.data.awb_no,
        response,
        payload: input.payload,
        note: EVENT_NOTE.late,
        writeEvent: true,
        actorUserId: input.actorUserId,
        ip: input.ip,
      });
      return;
    }
    const message = response.errors?.join("; ") || "ITD answered late with no airway bill number.";
    await fail(order, { stage: "create_docket", retry: response.errors?.length ? "ops" : "check_itd", message });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await fail(order, {
      stage: "timeout",
      retry: "check_itd",
      message: /timed out/i.test(message)
        ? "ITD never answered. It may still have filed this docket: check the customer's ITD account for it before retrying."
        : message,
    });
  } finally {
    await releaseDocketLock(order.id);
  }
}

// ── Automatic retries ──────────────────────────────────────────────────────

const RETRY_GAP_MS = 10 * 60 * 1000;

export type DocketSweepReport = { checked: number; issued: number; failed: number; handedToOps: number; skipped: number };

/**
 * Retry every order whose docket failed in a way that clears by itself.
 *
 * Run every 10 minutes (`startDocketRetryTimer`, and POST
 * /api/admin/dockets/retry for an external scheduler), and straight after a
 * customer adds an identity document (`force`, for that customer only). Safe
 * to run from several places at once: each filing takes the order's lock.
 */
export async function retryDocketsDue(opts: { userId?: string; force?: boolean } = {}): Promise<DocketSweepReport> {
  const report: DocketSweepReport = { checked: 0, issued: 0, failed: 0, handedToOps: 0, skipped: 0 };
  if (!isRealDocketFilingEnabled()) return report;
  const orders = await listOrdersForDocketRetry({ userId: opts.userId });

  for (const order of orders) {
    report.checked += 1;
    const err = ((order.metadata ?? {}) as Record<string, unknown>).docket_error as
      | { at?: string; attempts?: number; stage?: string; message?: string }
      | undefined;
    const attempts = typeof err?.attempts === "number" ? err.attempts : 1;

    // Waiting on the customer's ID document: only its upload (`force`, from
    // kycDb) retries it. The timer would otherwise spend its attempts in an
    // hour and hand ops an order nobody can do anything about yet.
    if (err?.stage === "kyc" && !opts.force) {
      report.skipped += 1;
      continue;
    }

    if (attempts >= DOCKET_AUTO_ATTEMPTS) {
      await recordBookingDocketError(order.id, {
        stage: err?.stage ?? "create_docket",
        retry: "ops",
        message: `${err?.message ?? "Filing failed."} Stopped retrying after ${attempts} attempts.`,
      });
      report.handedToOps += 1;
      continue;
    }
    const last = err?.at ? Date.parse(err.at) : 0;
    if (!opts.force && Number.isFinite(last) && Date.now() - last < RETRY_GAP_MS) {
      report.skipped += 1;
      continue;
    }

    const result = await fileDocket(order, { source: "auto_retry", actorUserId: null });
    if (result.status === "issued") report.issued += 1;
    else if (result.status === "failed") report.failed += 1;
    else report.skipped += 1;
  }

  if (report.checked) console.log("[docketFiling] retry sweep:", report);
  return report;
}

let timer: NodeJS.Timeout | null = null;

/** In-process sweep. The lock makes a second instance running it harmless. */
export function startDocketRetryTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    void retryDocketsDue().catch((err) => console.error("[docketFiling] sweep threw:", err));
  }, RETRY_GAP_MS);
  timer.unref?.();
}
