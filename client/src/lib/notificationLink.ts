/**
 * Where tapping a bell item leads, from its `data`: a shipment's tracking, or
 * BIA — asking about the support case our team just answered (BIA 3.0, 4.3;
 * server/supportCasesOps.ts writes `{ kind: "support_case", caseNo }`), or
 * about what a nudge was for (5.1; `{ kind: "bia_nudge", nudge, orderNo }`).
 */

import { isNudgeKind, nudgeSeed, type NudgeKind } from '@shared/biaNudges';

export type NotificationLink =
  | { kind: 'shipment'; awb: string }
  | { kind: 'case'; caseNo: string }
  | { kind: 'nudge'; nudge: NudgeKind; orderNo: string | null }
  | null;

const CASE_NO_RE = /^BIA-[0-9]{4,7}$/;
const ORDER_NO_RE = /^BOM-[0-9]{6,9}$/;

export function notificationLink(data: unknown): NotificationLink {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind === 'support_case' && typeof d.caseNo === 'string' && CASE_NO_RE.test(d.caseNo)) {
    return { kind: 'case', caseNo: d.caseNo };
  }
  if (d.kind === 'bia_nudge' && isNudgeKind(d.nudge)) {
    const orderNo = typeof d.orderNo === 'string' && ORDER_NO_RE.test(d.orderNo) ? d.orderNo : null;
    return { kind: 'nudge', nudge: d.nudge, orderNo };
  }
  return typeof d.awb === 'string' && d.awb ? { kind: 'shipment', awb: d.awb } : null;
}

/** What BIA is asked for the customer when they tap a case reply. */
export function caseReplySeed(caseNo: string): string {
  return `What did the team say on my case ${caseNo}?`;
}

/**
 * What BIA is asked when a bell item opens it: a case reply, or a nudge. The
 * words come from the kind and the order, never from the stored notification.
 */
export function seedFor(link: NotificationLink): string | null {
  if (link?.kind === 'case') return caseReplySeed(link.caseNo);
  if (link?.kind === 'nudge') return nudgeSeed(link.nudge, link.orderNo);
  return null;
}
