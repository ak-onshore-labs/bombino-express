/**
 * What the public parcel page (`/p/:token`) is told.
 *
 * Anyone holding the box can open it, so the base view is tracking only, the
 * same fields bombinoexp.com's tracking page shows: status, origin and
 * destination cities, service, AWB, forwarding number and the carrier's scans.
 * No names, phones, emails, street addresses, contents or weights. Ops users
 * get `staff` on top; nobody else does, agents included.
 */

export interface ParcelTagEvent {
  at: string;
  label: string;
  /** Where it happened, for carrier scans ("MUMBAI, MH"). */
  location?: string | null;
}

export interface ParcelTagParty {
  name: string | null;
  company: string | null;
  phone: string | null;
  address: string;
}

export interface ParcelTagView {
  orderNo: string;
  /** The 12-character ID printed under the QR, grouped ("7KQ2-MX9P-4HTR"). */
  parcelId: string | null;
  awbNo: string | null;
  /** Internal status, for the progress bar. */
  status: string;
  /** Customer-facing phrase. */
  statusLabel: string;
  isPickup: boolean;
  /** City level only: "Raigarh, Maharashtra". */
  origin: string;
  destination: string;
  service: string | null;
  pieces: string | null;
  bookedAt: string;
  /** Bombino's own steps, before the carrier has the parcel. */
  events: ParcelTagEvent[];
  /** The carrier's scans once shipped, newest first (as the website shows). */
  carrierEvents: ParcelTagEvent[];
  forwardingNo: string | null;
  /** Ops only. */
  bookedWeightKg: number | null;
  staff: {
    orderId: string;
    role: 'ops' | 'agent';
    assignedToMe: boolean;
    sender: ParcelTagParty;
    recipient: ParcelTagParty;
    contents: string | null;
  } | null;
}

/** What a staff scan resolves to. */
export interface ParcelScanResult {
  orderId: string;
  orderNo: string;
  assignedToMe: boolean;
  token: string;
  /** Box number, when the label carries one (ITD's "PARCEL NO." barcode). */
  piece?: number | null;
  /** Boxes on the order, as booked. */
  pieces?: number | null;
}
