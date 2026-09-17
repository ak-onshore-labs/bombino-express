/**
 * One movement on a parcel, as the tracking timeline renders it.
 *
 * ITD's own tracking payload is mapped into this by the screens that fetch it
 * (see `lib/shipmentApiTypes.ts` for the wire shape).
 */
export interface TrackingEvent {
  id: string;
  status: string;
  note: string;
  location: string;
  timestamp: Date;
}
