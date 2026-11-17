import { customerStatusForStatus, isTerminalOrderStatus } from '@shared/orderContract';
import {
  getStatusColor,
  getStatusLabel,
  isAwbStatusFinal,
  type AwbStatusTone,
} from '@/lib/awbStatus';

/**
 * Frozen status vocabulary from docs/final-phase/markdowns/final-phase-modules.md §3.
 *
 * These are the INTERNAL labels — what ops reads on the board. They name the
 * real status, including the three the customer is never shown. Do not put
 * these in front of a customer: use `getCustomerStatusLabel` for that.
 */
const ORDER_STATUS_MAP: Record<string, { label: string; tone: AwbStatusTone }> = {
  pickup_requested: { label: 'Pickup Requested', tone: 'gray' },
  agent_accepted: { label: 'Agent Assigned', tone: 'blue' },
  out_for_pickup: { label: 'Agent on the Way', tone: 'blue' },
  picked_up: { label: 'Picked Up', tone: 'blue' },
  awaiting_dropoff: { label: 'Awaiting Drop-off', tone: 'gray' },
  received_at_hub: { label: 'At Hub', tone: 'amber' },
  weighed: { label: 'Weighed', tone: 'amber' },
  settled: { label: 'Settled', tone: 'amber' },
  ready_for_docket: { label: 'Preparing Docket', tone: 'amber' },
  dispatched: { label: 'Dispatched', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};

/** The internal label. Ops surface only — see the note on ORDER_STATUS_MAP. */
export function getOrderStatusLabel(status: string): string {
  return ORDER_STATUS_MAP[status]?.label ?? status;
}

/**
 * The label a customer may see, straight off the shared contract.
 *
 * `weighed`, `settled` and `ready_for_docket` all collapse back to "Arrived at
 * Bombino hub". The customer's view deliberately sits still through the hub
 * phase — the parcel has not moved, and showing three internal steps invites
 * "what does settled mean?" for no gain. The tone already collapsed correctly;
 * only the words leaked.
 */
export function getCustomerStatusLabel(status: string): string {
  return customerStatusForStatus(status);
}

export function getOrderStatusTone(status: string): AwbStatusTone {
  return ORDER_STATUS_MAP[status]?.tone ?? 'gray';
}

/** Re-exported so customer screens have one import for status questions. */
export { isTerminalOrderStatus };

/** ITD's latest scan for the order's AWB, as `/api/orders` and the guest profile send it. */
export interface CarrierStatus {
  state: string;
  at: string;
}

/**
 * ITD has the parcel: it has scanned it past the booking entry.
 *
 * `ENTRY` ("shipment information received") is ITD acknowledging the docket,
 * which for a login customer happens at booking, long before the parcel moves.
 * Anything after it means the parcel is in ITD's hands.
 */
export function carrierHasParcel(state: string | null | undefined): boolean {
  const key = (state ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return key !== '' && key !== 'ENTRY';
}

/**
 * What a customer list shows for an order.
 *
 * Our status moves only when Bombino staff press a button; ITD's follows the
 * parcel. Once ITD has the parcel its word wins, so an order ops never marked
 * dispatched cannot read "Arrived at Bombino hub" while tracking says
 * "Delivered" (BOM-100347). A cancelled order stays cancelled.
 */
export function customerOrderStatus(
  status: string,
  carrier: CarrierStatus | null | undefined
): { label: string; tone: AwbStatusTone; shipped: boolean; final: boolean } {
  if (status !== 'cancelled' && carrierHasParcel(carrier?.state)) {
    const state = carrier!.state;
    return {
      label: getStatusLabel(state),
      tone: getStatusColor(state),
      shipped: true,
      final: isAwbStatusFinal(state),
    };
  }
  return {
    label: getCustomerStatusLabel(status),
    tone: getOrderStatusTone(status),
    shipped: status === 'dispatched',
    final: isTerminalOrderStatus(status),
  };
}
