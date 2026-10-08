/**
 * What the public parcel page (`/p/:token`) is told.
 *
 * Anyone holding the box can open it, so the base view carries nothing that
 * identifies a person: no names, phones, emails or street addresses. Any
 * signed-in agent or ops user gets `staff` on top.
 */

export interface ParcelTagEvent {
  at: string;
  label: string;
}

export interface ParcelTagParty {
  name: string | null;
  company: string | null;
  phone: string | null;
  address: string;
}

export interface ParcelTagView {
  orderNo: string;
  awbNo: string | null;
  /** Internal status, for the progress bar. */
  status: string;
  /** Customer-facing phrase. */
  statusLabel: string;
  isPickup: boolean;
  destination: string;
  pieces: string | null;
  bookedWeightKg: number | null;
  bookedAt: string;
  events: ParcelTagEvent[];
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
}
