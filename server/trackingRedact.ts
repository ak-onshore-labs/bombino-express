/**
 * What an AWB's tracking shows to someone who is not its owner.
 *
 * Anyone can track any AWB (the screen asks for no login), so a stranger who
 * types or scans a number must see what bombinoexp.com's tracking shows and
 * nothing more: status, origin and destination (city/country), service,
 * booking date, forwarding number, and the scans (event, place, time). Names,
 * companies, phones, addresses, pincodes, weights and scan remarks (which can
 * carry who signed for it) are dropped here, on the server, so no client can
 * show them by mistake.
 *
 * The owner (the account that booked it, the guest whose order it is) and ops
 * get ITD's answer untouched.
 */

import type { ITDTrackingResult } from "./itd.js";

/** docket_info rows a stranger may see, by ITD's label. */
const PUBLIC_DOCKET_KEYS: ReadonlySet<string> = new Set([
  "Status",
  "Origin",
  "Origin Country",
  "Destination",
  "Destination Country",
  "Shipper City",
  "Consignee City",
  "Consignee State",
  "Consignee Country",
  "Service Name",
  "Booking Date",
  "Created",
  "Forwarding No.",
]);

export function redactTracking(results: ITDTrackingResult[]): ITDTrackingResult[] {
  return results.map((r) => ({
    ...r,
    chargeable_weight: "",
    pcs: "",
    docket_info: (r.docket_info ?? []).filter(([key]) => PUBLIC_DOCKET_KEYS.has(String(key).trim())),
    docket_events: (r.docket_events ?? []).map((e) => ({
      ...e,
      // Remarks are free text ("RECEIVED BY JOHN", a phone number): never public.
      event_remark: "",
    })),
    // Per-piece detail is the owner's business.
    parcel_docket_events: {},
    all_parcel_no: {},
  }));
}
