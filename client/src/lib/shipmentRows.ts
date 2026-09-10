import type { ShipmentHistoryItem } from '@/lib/shipmentApiTypes';
import type { GuestOrderSummary } from '@/lib/shadowProfile';
import {
  getStatusLabel,
  getStatusColor,
  isAwbStatusFinal,
  type AwbStatusTone,
} from '@/lib/awbStatus';
import {
  getCustomerStatusLabel,
  getOrderStatusTone,
  isTerminalOrderStatus,
} from '@/lib/orderStatus';

/** Row shape from GET /api/orders (server/ordersDb.ts OrderRow) */
export interface OrderApiRow {
  id: string;
  order_no: string;
  status: string;
  consignee: { name?: string; city?: string; country_name?: string } | null;
  items: { api_service_code?: string; free_form_currency?: string } | null;
  quoted_amount: number | null;
  final_amount: number | null;
  awb_no: string | null;
  created_at: string;
  updated_at: string;
}

/** Unified display row — either a real ITD shipment or a pre-docket Bombino order. */
export interface DisplayRow {
  key: string;
  displayId: string; // awb_number or order_no
  isOrder: boolean;
  recipient: string;
  city: string;
  country: string;
  service: string;
  bookingDate: string | null;
  amountStr: string | null;
  statusLabel: string;
  statusTone: AwbStatusTone;
  createdAt: string;
  /** Last movement. Drives list order so a just-advanced order leads. */
  updatedAt: string;
  /**
   * Still capable of changing. False once an order is dispatched or cancelled,
   * or once ITD has said its last word on an AWB.
   *
   * The list polls only while at least one row is live, so a customer whose
   * parcels have all arrived stops costing requests. Presentation only — never
   * a guard.
   */
  isLive: boolean;
  /**
   * The AWB, when this parcel has one.
   *
   * On a shipment row it is always `displayId`. On an ORDER row it is usually
   * null — but not always: an ITD-credentialled customer's order is docketed
   * at booking, so it carries a real AWB from its first minute while still
   * being an order in every other respect. Kept separate from `displayId`
   * because such an order is still addressed by its BOM number, and separate
   * from `isOrder` because an AWB no longer answers "is this an order".
   */
  awb: string | null;
}

export function formatShipmentAmount(amount: string | number | null, currency: string | null): string | null {
  if (amount === null || amount === undefined) return null;
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return null;
  const cur = (currency ?? 'INR').toUpperCase();
  if (cur === 'INR' || cur === '₹') {
    return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
  return `${cur} ${n.toLocaleString()}`;
}

export function shipmentToRow(item: ShipmentHistoryItem): DisplayRow {
  const hasStatus = !!item.current_status?.trim();
  return {
    key: `shipment-${item.awb_number}`,
    displayId: item.awb_number,
    isOrder: false,
    recipient: item.consignee_name?.trim() || 'Unnamed recipient',
    city: item.consignee_city?.trim() || '',
    country: item.consignee_country?.trim() || '',
    service: item.service_name?.trim() || '',
    bookingDate: item.booking_date,
    amountStr: formatShipmentAmount(item.total_amount, item.currency),
    statusLabel: hasStatus ? getStatusLabel(item.current_status as string) : 'Unknown',
    statusTone: hasStatus ? getStatusColor(item.current_status as string) : 'gray',
    createdAt: item.created_at,
    // Older server builds did not select updated_at; fall back rather than
    // sorting these to the epoch and burying them.
    updatedAt: item.updated_at ?? item.created_at,
    isLive: !isAwbStatusFinal(item.current_status),
    awb: item.awb_number,
  };
}

export function orderToRow(order: OrderApiRow): DisplayRow {
  return {
    key: `order-${order.id}`,
    displayId: order.order_no,
    isOrder: true,
    recipient: order.consignee?.name?.trim() || 'Unnamed recipient',
    city: order.consignee?.city?.trim() || '',
    country: order.consignee?.country_name?.trim() || '',
    service: order.items?.api_service_code?.trim() || '',
    bookingDate: order.created_at,
    // Always INR. `items.free_form_currency` is the CUSTOMS declared-value
    // currency of the goods (USD for a US destination, QAR for Qatar) and has
    // nothing to do with what the customer pays Bombino — that is a rupee
    // freight charge from the ITD rate call. Passing it here rendered
    // ₹1,705.10 as "QAR 1,705".
    amountStr: formatShipmentAmount(order.final_amount ?? order.quoted_amount, 'INR'),
    // Customer vocabulary, not the internal one. This list is a customer
    // surface, so `weighed`/`settled`/`ready_for_docket` must all read
    // "Arrived at Bombino hub" — same phrase the detail screen shows.
    statusLabel: getCustomerStatusLabel(order.status),
    statusTone: getOrderStatusTone(order.status),
    createdAt: order.created_at,
    updatedAt: order.updated_at ?? order.created_at,
    isLive: !isTerminalOrderStatus(order.status),
    awb: order.awb_no,
  };
}

/**
 * A guest's booking, as a row in the same list an account's orders use.
 *
 * Guests have no /api/orders — their bookings come off /api/guest/profile —
 * but on the Orders screen they should read exactly like an account's: same
 * card, same status vocabulary, same amount rule (INR, final over quoted).
 */
export function guestOrderToRow(order: GuestOrderSummary): DisplayRow {
  return {
    key: `guest-order-${order.order_id}`,
    displayId: order.order_no,
    isOrder: true,
    recipient: order.recipient?.trim() || 'Unnamed recipient',
    city: order.city?.trim() || '',
    country: order.country?.trim() || '',
    service: order.service?.trim() || '',
    bookingDate: order.created_at,
    amountStr: formatShipmentAmount(order.final_amount ?? order.quoted_amount ?? null, 'INR'),
    statusLabel: getCustomerStatusLabel(order.status),
    statusTone: getOrderStatusTone(order.status),
    createdAt: order.created_at,
    updatedAt: order.updated_at ?? order.created_at,
    isLive: !isTerminalOrderStatus(order.status),
    awb: order.awb_no,
  };
}

/** Fetches /api/shipments/history + /api/orders in parallel and merges into one
 *  newest-first list. Used by Home (mobile + desktop) and Orders so a booking
 *  shows up everywhere, not just in one place. */
export async function fetchMergedShipmentRows(): Promise<DisplayRow[]> {
  const [shipmentsRes, ordersRes] = await Promise.all([
    fetch('/api/shipments/history', { credentials: 'include' }).catch(() => null),
    fetch('/api/orders', { credentials: 'include' }).catch(() => null),
  ]);

  const shipmentRows: DisplayRow[] =
    shipmentsRes && shipmentsRes.ok
      ? ((await shipmentsRes.json().catch(() => [])) as ShipmentHistoryItem[]).map(shipmentToRow)
      : [];
  const orderRows: DisplayRow[] =
    ordersRes && ordersRes.ok
      ? (((await ordersRes.json().catch(() => ({ orders: [] }))) as { orders: OrderApiRow[] }).orders ?? []).map(
          orderToRow
        )
      : [];

  // One parcel, one row.
  //
  // The two feeds overlap now. A docket filed at booking writes a `shipments`
  // row immediately (server/persistShipment.ts), so an ITD-credentialled
  // customer's parcel comes back from BOTH endpoints — once as `BOM-100042`
  // and once as its AWB — with different keys, so nothing deduped them.
  //
  // The order row wins while the order is still running: it is the surface
  // that knows about pickup, weighing and payment, and it is what its links
  // point at. Once the order is terminal the shipment row is the live one and
  // the order has nothing left to say.
  const ordersByAwb = new Map(
    orderRows.filter((r) => r.awb && r.isLive).map((r) => [r.awb as string, r])
  );
  const merged = [
    ...shipmentRows.filter((r) => !ordersByAwb.has(r.displayId)),
    ...orderRows,
  ];

  // Most recently moved first, not most recently booked. An order an agent
  // just advanced is the one the customer is asking about, even if they booked
  // it days before something else. Ties fall back to booking time so the order
  // stays stable for rows that have never moved.
  return merged.sort((a, b) => {
    const delta = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    return delta !== 0 ? delta : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
