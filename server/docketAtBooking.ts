/**
 * ── Docket at booking ───────────────────────────────────────────────────────
 *
 *   ITD_DOCKET_AT_BOOKING=1
 *
 * Files a real ITD docket the moment an ITD-credentialled customer books,
 * instead of waiting for ops to do it at `settled`. Who that applies to, and
 * why it applies to nobody else, is documented on `docketAtBooking` below.
 *
 * ON by default in production builds (NODE_ENV=production), OFF by default
 * everywhere else. `ITD_DOCKET_AT_BOOKING=1` forces it on and `=0` forces it
 * off, in either.
 *
 * Defaulted on in production because the app is served by more than one
 * deployment, and a deployment missing the variable silently booked every
 * order without an AWB (BOM-100317, 100318, 100324). Defaulted off in
 * development because THERE IS NO ITD SANDBOX: `ADMIN_BASE` in server/itd.ts
 * points at https://admin.bombinoexp.com — production — and local servers
 * share the production database. Every docket this fires is a real shipment
 * against real customer accounts, and ITD permits no amendment to one once
 * filed.
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

import { fileDocket, isRealDocketFilingEnabled } from "./docketFiling.js";
import type { Order } from "../shared/orderContract.js";

/** Lives in docketFiling.ts now: it gates every real filing, not only booking's. */
export { isRealDocketFilingEnabled as isDocketAtBookingEnabled };

/** Called once at boot. Silent when the flag is off. */
export function warnIfDocketAtBookingEnabled(): void {
  if (!isRealDocketFilingEnabled()) return;

  const where =
    process.env.NODE_ENV === "production" ? "a PRODUCTION build" : "development";

  console.warn(
    [
      "",
      "  ############################################################",
      `  ##  ITD_DOCKET_AT_BOOKING ${process.env.ITD_DOCKET_AT_BOOKING?.trim() === "1" ? "=1" : "on (production default)"}`,
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

/**
 * The filing itself, its pre-checks, retries and late answers now live in
 * server/docketFiling.ts, shared with the retry sweep and the ops actions.
 * This is only the booking's door into it.
 */
export async function docketAtBooking(
  req: Request,
  order: Order
): Promise<BookingDocketOutcome> {
  if (!isRealDocketFilingEnabled()) return SKIPPED;
  // A guest order has no account and therefore no ITD credential. It is also
  // the cohort this whole split exists to keep OUT of ITD at booking.
  if (!order.user_id) return SKIPPED;

  const result = await fileDocket(order, {
    source: "booking",
    actorUserId: order.user_id,
    sessionToken: req.session.itdToken ?? null,
    onToken: (token) => {
      req.session.itdToken = token;
    },
    ip: req.ip,
  });

  switch (result.status) {
    case "issued":
      return { status: "issued", awb_no: result.awb_no, message: null };
    case "failed":
      return { status: "failed", awb_no: null, message: result.message };
    default:
      // No ITD login of their own (filed by ops), or already being filed.
      return SKIPPED;
  }
}
