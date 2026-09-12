/**
 * Where tapping a bell item leads, from its `data`: a shipment's tracking, or
 * (BIA 3.0, 4.3) BIA, asking about the support case our team just answered
 * (server/supportCasesOps.ts writes `{ kind: "support_case", caseNo }`).
 */

export type NotificationLink =
  | { kind: 'shipment'; awb: string }
  | { kind: 'case'; caseNo: string }
  | null;

const CASE_NO_RE = /^BIA-[0-9]{4,7}$/;

export function notificationLink(data: unknown): NotificationLink {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind === 'support_case' && typeof d.caseNo === 'string' && CASE_NO_RE.test(d.caseNo)) {
    return { kind: 'case', caseNo: d.caseNo };
  }
  return typeof d.awb === 'string' && d.awb ? { kind: 'shipment', awb: d.awb } : null;
}

/** What BIA is asked for the customer when they tap a case reply. */
export function caseReplySeed(caseNo: string): string {
  return `What did the team say on my case ${caseNo}?`;
}
