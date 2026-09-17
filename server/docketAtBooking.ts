/**
 * ── Docket at booking ───────────────────────────────────────────────────────
 *
 *   ITD_DOCKET_AT_BOOKING=1
 *
 * Files a real ITD docket the moment an ITD-credentialled customer books,
 * instead of waiting for ops to do it at `settled`. Who that applies to, and
 * why it applies to nobody else, is documented on `docketAtBooking` below.
 *
 * OFF unless explicitly set, and it must be turned on per environment rather
 * than defaulted, because THERE IS NO ITD SANDBOX. `ADMIN_BASE` in
 * server/itd.ts points at https://admin.bombinoexp.com — production. Every
 * docket this fires is a real shipment against real customer accounts, and ITD
 * permits no amendment to one once filed.
 *
 * Two things are worth knowing before switching it on:
 *
 *   - The weight sent is the customer's own declared estimate, taken from the
 *     booking form, not a hub scale reading. Docketing at booking means the
 *     reprice at the hub can no longer reach ITD.
 *   - `shipment_invoice_no` is still hardcoded to 'TESTINV01' in
 *     client/src/pages/CreateShipment.tsx, and it goes to Indian customs.
 *
 * Like PAYMENTS_TEST_MODE this is honoured in production builds, because the
 * deployed staging environment runs NODE_ENV=production and is exactly where
 * this needs exercising first.
 */

import type { Request } from "express";

import { buildItdKycPayload } from "../shared/kyc.js";
import { itdClient, isItdAuthExpired, type CreateShipmentPayload } from "./itd.js";
import { mintItdSession, withTimeout } from "./itdTokenRefresh.js";
import { itdUserHasStoredPassword } from "./appDb.js";
import { applyBookingDocket, insertOrderEvent, recordBookingDocketError } from "./ordersDb.js";
import { persistShipmentAfterCreate } from "./persistShipment.js";
import { kycForOrder } from "./kycPolicy.js";
import type { Order } from "../shared/orderContract.js";

export function isDocketAtBookingEnabled(): boolean {
  return process.env.ITD_DOCKET_AT_BOOKING === "1";
}

/** Called once at boot. Silent when the flag is off. */
export function warnIfDocketAtBookingEnabled(): void {
  if (!isDocketAtBookingEnabled()) return;

  const where =
    process.env.NODE_ENV === "production" ? "a PRODUCTION build" : "development";

  console.warn(
    [
      "",
      "  ############################################################",
      "  ##  ITD_DOCKET_AT_BOOKING=1",
      "  ##  Bookings by ITD-linked accounts file a REAL ITD docket",
      "  ##  immediately. ITD has no sandbox and permits no amendment.",
      `  ##  Running in ${where}.`,
      "  ##  The weight filed is the customer's booking estimate.",
      "  ############################################################",
      "",
    ].join("\n")
  );
}

/**
 * File an ITD docket for an order the moment it is booked.
 *
 * ── Why only some orders ──────────────────────────────────────────────────
 *
 * `create_docket` has no customer field: ITD attributes a shipment to
 * whoever's session token makes the call (server/itd.ts §createShipment).
 * That is the open question M5 is blocked on — ops cannot docket on a
 * customer's behalf because ops holds no customer token, and `add_customer`
 * issues no credentials to get one.
 *
 * But the question does not arise for a customer who already HAS an ITD
 * login. They linked it themselves through POST /api/auth/link/itd, which
 * stored their password encrypted precisely so `mintItdSession` can replay it
 * — ITD has no refresh token, so replaying the password is the only way to
 * mint one. For those accounts the right token is available at booking, on
 * the customer's own credential, and the docket lands on their own ITD
 * account with no attribution to guess at.
 *
 * Everyone else — guests, and accounts opened by OTP signup, which are
 * `local-<uuid>` rows with no ITD credential anywhere — is untouched here and
 * still dockets the ordinary way, by ops at `settled`.
 *
 * The test is capability, not provenance: `itdUserHasStoredPassword`, the
 * same gate `mintItdSession` applies internally. NOT the `local-` prefix,
 * which is a superset — a genuine ITD row loses its credential on phone
 * unlink, and POST /api/auth/login silently stores none when ENCRYPTION_KEY
 * is unset.
 *
 * ── Why the payload is not built here ─────────────────────────────────────
 *
 * `order.items` already IS a complete CreateShipmentPayload — the booking
 * form builds one and posts it verbatim (client CreateShipment.tsx). Only the
 * three KYC fields are missing, for the same reason they are missing on
 * POST /api/shipments: they are derived server-side from the stored document
 * and must never be taken from the client.
 *
 * ── Failure ───────────────────────────────────────────────────────────────
 *
 * Never throws, never fails the booking. The order is already committed when
 * this runs; a docket is something added on top of it. A failure leaves
 * `awb_no` null, which is the state every guest order is in anyway, so the
 * order simply falls back to being docketed by ops at `settled` — and stamps
 * `metadata.docket_error` so the ops board can say so out loud rather than
 * leaving it to look like an ordinary pre-docket booking.
 */
type BookingDocketOutcome = {
  status: "issued" | "failed" | "skipped";
  awb_no: string | null;
  message: string | null;
};

const SKIPPED: BookingDocketOutcome = { status: "skipped", awb_no: null, message: null };

const BOOKING_DOCKET_TIMEOUT_MS = 15_000;

export async function docketAtBooking(
  req: Request,
  order: Order
): Promise<BookingDocketOutcome> {
  if (!isDocketAtBookingEnabled()) return SKIPPED;

  // A guest order has no account and therefore no ITD credential. It is also
  // the cohort this whole split exists to keep OUT of ITD at booking.
  const dbUserId = order.user_id;
  if (!dbUserId) return SKIPPED;

  // No KYC hold: KYC is decided by Cashfree Smart OCR alone and never stops
  // an AWB. The document itself is still required — `kycForOrder` below
  // refuses a docket with nothing on file, and says so in `docket_error`.
  if (!(await itdUserHasStoredPassword(dbUserId))) return SKIPPED;

  // POST /api/orders does not sit behind refreshItdTokenIfNeeded, so a
  // session older than the token is entirely ordinary here. mintItdSession
  // replays the stored password and returns null rather than throwing.
  let token = req.session.itdToken;
  if (!token) {
    const email = req.session.user?.email;
    if (email) await mintItdSession(req, dbUserId, email);
    token = req.session.itdToken;
  }
  if (!token) {
    const message = "Could not sign in to ITD to issue an airway bill.";
    await recordBookingDocketError(order.id, { stage: "token", message });
    return { status: "failed", awb_no: null, message };
  }

  const kyc = await kycForOrder(order);
  if (!kyc) {
    const message = "No identity document on file to file with the airway bill.";
    await recordBookingDocketError(order.id, { stage: "kyc", message });
    return { status: "failed", awb_no: null, message };
  }

  // `order.items` is the payload the form built, read back from the row we
  // just wrote rather than from req.body — so what ITD is sent is exactly
  // what was persisted, and the two can never drift.
  const payload = {
    ...(order.items as Record<string, unknown>),
  } as unknown as CreateShipmentPayload;

  const publicUrl =
    process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 5000}`;
  const kycPayload = buildItdKycPayload(
    {
      document_type: kyc.document_type,
      document_no: kyc.document_no,
      capability_id: kyc.capability_id,
    },
    publicUrl
  );
  payload.kyc_details = kycPayload.kyc_details;
  payload.shipper_gstin_type = kycPayload.shipper_gstin_type;
  payload.shipper_gstin_no = kycPayload.shipper_gstin_no;

  // One retry, and only on an expired token.
  //
  // The block above mints only when the session carries NO token. A session
  // carrying a stale one skips minting, sends it, and ITD answers 500 with
  // AUTH TOKEN EXPIRED — not 401, so `createShipment` throws it as an
  // ordinary error and nothing upstream recognises it as an auth problem.
  //
  // Expiry cannot be predicted into. ITD's auth response carries no expiry
  // field, so `itdTokenExpiryIso` writes a guessed 24 hours for an endpoint
  // the company token in itd.ts treats as 4 — a token is routinely dead long
  // before anything thinks it is due for refresh. Reacting to the refusal is
  // the only reliable signal there is.
  //
  // Strictly once: a second expiry on a token minted seconds earlier means
  // the credential itself is wrong, and retrying that files nothing but load.
  let itdResponse: Awaited<ReturnType<typeof itdClient.createShipment>> | null = null;
  let failure: string | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 1) {
      const email = req.session.user?.email;
      const minted = email ? await mintItdSession(req, dbUserId, email) : null;
      if (!minted || !req.session.itdToken) {
        // Keep the ITD refusal as the reason. "Could not re-mint" is the
        // symptom of it, and the first message is the one that names ITD.
        break;
      }
      token = req.session.itdToken;
      console.log(
        `[docketAtBooking] ${order.order_no}: ITD token had expired, minted a new one and retrying`
      );
    }

    try {
      console.log(
        `[docketAtBooking] filing ITD docket for order ${order.order_no} (user ${dbUserId})`
      );
      itdResponse = await withTimeout(
        itdClient.createShipment(payload, token),
        BOOKING_DOCKET_TIMEOUT_MS,
        "ITD create_docket (booking)"
      );
      failure = null;
      break;
    } catch (err) {
      failure = err instanceof Error ? err.message : "ITD refused the docket.";
      itdResponse = null;
      if (!isItdAuthExpired(failure)) break;
    }
  }

  if (!itdResponse) {
    const message = failure ?? "ITD refused the docket.";
    console.error(`[docketAtBooking] ${order.order_no} failed:`, message);
    await recordBookingDocketError(order.id, { stage: "create_docket", message });
    return { status: "failed", awb_no: null, message };
  }

  if (!itdResponse.success || !itdResponse.data?.awb_no) {
    const message = itdResponse.errors?.join("; ") || "ITD returned no airway bill number.";
    console.error(`[docketAtBooking] ${order.order_no} rejected:`, message);
    await recordBookingDocketError(order.id, { stage: "create_docket", message });
    return { status: "failed", awb_no: null, message };
  }

  const awb = itdResponse.data.awb_no;

  // Status is deliberately untouched: ITD holds the shipment, but the parcel
  // is still in the customer's house and has to be collected, weighed and
  // paid for exactly as before.
  const docketed = await applyBookingDocket({
    orderId: order.id,
    awbNo: awb,
    docketResponse: itdResponse,
  });
  if (!docketed) {
    // The AWB exists at ITD but the row would not take it — a concurrent
    // write, or a DB blip. Say so loudly: this is the one failure mode that
    // leaves the two sides disagreeing, and it needs a human.
    const message = `ITD issued AWB ${awb} but it could not be saved against this order.`;
    console.error(`[docketAtBooking] ${order.order_no}: ${message}`);
    await recordBookingDocketError(order.id, { stage: "persist", message });
    return { status: "failed", awb_no: null, message };
  }

  void insertOrderEvent({
    order_id: order.id,
    status: order.status,
    note: `Docket filed at booking · AWB ${awb}`,
    actor_user_id: dbUserId,
    metadata: { action: "docket_at_booking", awb_no: awb },
  });

  // The `shipments` row and its addresses, so tracking and the documents
  // endpoint have something to read. `notifyDispatch: false` because the
  // parcel has not shipped — see the note on persistShipmentAfterCreate.
  void persistShipmentAfterCreate(dbUserId, payload, itdResponse, req.ip, {
    notifyDispatch: false,
  });

  return { status: "issued", awb_no: awb, message: null };
}
