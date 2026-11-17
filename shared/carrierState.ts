/**
 * Reading ITD's tracking state for an order's AWB. Shared so the server's
 * auto-dispatch (server/carrierStatus.ts) and the customer screens agree on
 * when ITD "has the parcel".
 */

/** ITD's latest scan for an AWB: its `event_state` and when it happened. */
export type CarrierStatus = { state: string; at: string };

/**
 * States that do not mean the parcel left us:
 * - `ENTRY` ("shipment information received") is ITD acknowledging the
 *   docket, which for a login customer happens at booking, long before the
 *   parcel moves.
 * - `CANCELLED` is the docket being withdrawn, not the parcel moving.
 */
const NOT_MOVED: ReadonlySet<string> = new Set(["ENTRY", "CANCELLED"]);

/** ITD has scanned the parcel past the booking entry: it is in ITD's hands. */
export function carrierHasParcel(state: string | null | undefined): boolean {
  const key = (state ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  return key !== "" && !NOT_MOVED.has(key);
}
