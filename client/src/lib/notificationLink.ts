/**
 * Where tapping a bell item leads, from its `data`: a shipment's tracking, an
 * order's page (or its handover code on it), or BIA, asking about what a nudge
 * was for (BIA 3.0, 5.1; server/supportNudges.ts writes
 * `{ kind: "bia_nudge", nudge, orderNo }`).
 *
 * Also which shelf of the bell an item sits on — see `notificationCategory`.
 */

import { isNudgeKind, nudgeSeed, type NudgeKind } from '@shared/biaNudges';
import { isOrderStatus, type OrderStatus } from '@shared/orderContract';

export type NotificationLink =
  | { kind: 'shipment'; awb: string }
  | { kind: 'order'; orderNo: string }
  | { kind: 'code'; orderNo: string; handover: 'pickup' | 'dropoff' }
  | { kind: 'nudge'; nudge: NudgeKind; orderNo: string | null }
  | { kind: 'page'; href: string; label: string }
  | null;

const ORDER_NO_RE = /^BOM-[0-9]{6,9}$/;

function orderNoOf(d: Record<string, unknown>): string | null {
  const v = d.order_no ?? d.orderNo;
  return typeof v === 'string' && ORDER_NO_RE.test(v) ? v : null;
}

export function notificationLink(data: unknown): NotificationLink {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind === 'bia_nudge' && isNudgeKind(d.nudge)) {
    return { kind: 'nudge', nudge: d.nudge, orderNo: orderNoOf(d) };
  }
  if (d.kind === 'handover_code') {
    const orderNo = orderNoOf(d);
    const handover = d.handover === 'dropoff' ? 'dropoff' : 'pickup';
    return orderNo ? { kind: 'code', orderNo, handover } : null;
  }
  // The order page before tracking: it shows the AWB too, and everything else.
  const orderNo = orderNoOf(d);
  if (orderNo) return { kind: 'order', orderNo };
  return typeof d.awb === 'string' && d.awb ? { kind: 'shipment', awb: d.awb } : null;
}

export interface NoticeFields {
  orderNo: string | null;
  awb: string | null;
  destination: string | null;
  /** The body with the references stripped out, since the card shows them as fields. */
  message: string;
}

const AWB_RE = /^[A-Za-z0-9-]{4,30}$/;

/**
 * The references a card shows as labelled fields. Older rows carry only some
 * of them — an order row from before the AWB was added, a "Shipment Booked"
 * row with only the AWB — so each is optional.
 */
export function noticeFields(n: { body: string | null; data: unknown }): NoticeFields {
  const d = (n.data && typeof n.data === 'object' ? n.data : {}) as Record<string, unknown>;
  const orderNo = orderNoOf(d);
  const awb = typeof d.awb === 'string' && AWB_RE.test(d.awb) ? d.awb : null;
  const destination = typeof d.destination === 'string' && d.destination.trim() ? d.destination.trim() : null;

  let message = (n.body ?? '').trim();
  // Order rows are written "BOM-100200 — what happened".
  if (orderNo && message.startsWith(orderNo)) message = message.slice(orderNo.length).replace(/^\s*[—–-]\s*/, '');
  // "Shipment Booked" rows end "… AWB: 1234567890".
  if (awb) message = message.replace(new RegExp(`\\s*AWB:?\\s*${awb}\\.?$`), '');
  message = message.trim();
  if (message) message = message[0].toUpperCase() + message.slice(1);

  return { orderNo, awb, destination, message };
}

/**
 * Where an account row leads. These rows are all `type: "account"` with
 * nothing in `data` to say which screen they belong to, so the words decide —
 * the titles are fixed strings in `server/accountApplications.ts`,
 * `accountApproval.ts` and the phone routes in `routes.ts`.
 */
function accountLink(title: string, d: Record<string, unknown>): NotificationLink {
  const t = title.toLowerCase();
  if (typeof d.phone === 'string' || t.includes('mobile number')) {
    return { kind: 'page', href: '/profile#phone', label: 'View number' };
  }
  if (t.includes('needs a change')) return { kind: 'page', href: '/application/fix', label: 'Fix application' };
  if (t.includes('account is ready')) return { kind: 'page', href: '/orders', label: 'Go to orders' };
  if (typeof d.application_id === 'string' || t.includes('application') || t.includes('account not opened')) {
    return { kind: 'page', href: '/guest-profile', label: 'View application' };
  }
  return { kind: 'page', href: '/profile', label: 'Open profile' };
}

/** Where a whole row leads: `notificationLink` for anything `data` explains, the account screens otherwise. */
export function notificationTarget(n: { type: string | null; title: string | null; data: unknown }): NotificationLink {
  if (n.type === 'account') {
    const d = (n.data && typeof n.data === 'object' ? n.data : {}) as Record<string, unknown>;
    return accountLink(n.title ?? '', d);
  }
  return notificationLink(n.data);
}

/** The in-app path a link opens, with a `#section` where one applies. */
export function hrefFor(link: NotificationLink): string | null {
  switch (link?.kind) {
    case 'page':
      return link.href;
    case 'shipment':
      return `/shipment/${encodeURIComponent(link.awb)}`;
    case 'order':
      return `/order/${encodeURIComponent(link.orderNo)}`;
    case 'code':
      return `/order/${encodeURIComponent(link.orderNo)}#handover-code`;
    default:
      return null;
  }
}

/**
 * What BIA is asked when a nudge opens it. The words come from the kind and
 * the order, never from the stored notification.
 */
export function seedFor(link: NotificationLink): string | null {
  if (link?.kind === 'nudge') return nudgeSeed(link.nudge, link.orderNo);
  return null;
}

// ── Shelves ────────────────────────────────────────────────────────────────

/**
 * The bell's tabs. "OTPs" are the handover OTPs (`server/handoverCodes.ts`):
 * the ones the customer reads to an agent or at the counter. Login OTPs never
 * land here — they go by SMS to someone not yet signed in.
 */
export type NotificationCategory = 'shipments' | 'otps' | 'account' | 'tips';

/** How loud an item's icon is. Colour is never the only signal — each has its own glyph. */
export type NotificationTone = 'neutral' | 'progress' | 'success' | 'warning' | 'code' | 'tip';

export function notificationCategory(n: { type: string | null; data: unknown }): NotificationCategory {
  const link = notificationLink(n.data);
  if (n.type === 'handover_code' || link?.kind === 'code') return 'otps';
  if (n.type === 'bia_nudge' || link?.kind === 'nudge') return 'tips';
  if (n.type === 'account') return 'account';
  return 'shipments';
}

export function notificationTone(n: {
  type: string | null;
  title: string | null;
  data: unknown;
}): NotificationTone {
  const category = notificationCategory(n);
  if (category === 'otps') return 'code';
  if (category === 'tips') return 'tip';

  const d = (n.data && typeof n.data === 'object' ? n.data : {}) as Record<string, unknown>;
  const title = (n.title ?? '').toLowerCase();
  if (
    n.type === 'exception' ||
    n.type === 'customs_hold' ||
    d.cancellation === 'rejected' ||
    /hold|declined|not opened|needs a change|failed/.test(title)
  ) {
    return 'warning';
  }

  if (category === 'account') return title.includes('ready') ? 'success' : 'neutral';

  if (n.type === 'shipment_created') return 'progress';
  const status: OrderStatus | null = isOrderStatus(d.status) ? d.status : null;
  if (status === 'cancelled') return 'warning';
  if (status === 'dispatched') return 'success';
  return 'progress';
}
