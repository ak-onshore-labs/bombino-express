/**
 * Where tapping a bell item leads, from its `data`: a shipment's tracking, or
 * BIA, asking about what a nudge was for (BIA 3.0, 5.1; server/supportNudges.ts
 * writes `{ kind: "bia_nudge", nudge, orderNo }`).
 */

import { isNudgeKind, nudgeSeed, type NudgeKind } from '@shared/biaNudges';

export type NotificationLink =
  | { kind: 'shipment'; awb: string }
  | { kind: 'nudge'; nudge: NudgeKind; orderNo: string | null }
  | null;

const ORDER_NO_RE = /^BOM-[0-9]{6,9}$/;

export function notificationLink(data: unknown): NotificationLink {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind === 'bia_nudge' && isNudgeKind(d.nudge)) {
    const orderNo = typeof d.orderNo === 'string' && ORDER_NO_RE.test(d.orderNo) ? d.orderNo : null;
    return { kind: 'nudge', nudge: d.nudge, orderNo };
  }
  return typeof d.awb === 'string' && d.awb ? { kind: 'shipment', awb: d.awb } : null;
}

/**
 * What BIA is asked when a nudge opens it. The words come from the kind and
 * the order, never from the stored notification.
 */
export function seedFor(link: NotificationLink): string | null {
  if (link?.kind === 'nudge') return nudgeSeed(link.nudge, link.orderNo);
  return null;
}
