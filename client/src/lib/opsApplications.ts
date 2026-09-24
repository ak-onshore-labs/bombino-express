import type { ApplicationStatus } from '@shared/applicationStatus';

/**
 * The ops console's words for an application's status. Not the customer's
 * (shared/applicationStatus.ts §APPLICATION_STATUS_COPY): staff need to know
 * whose move it is, the customer needs to know what happens next.
 */
export const OPS_STATUS_LABEL: Record<ApplicationStatus, string> = {
  submitted: 'New',
  in_review: 'In review',
  changes_requested: 'Waiting on customer',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const OPS_STATUS_TONE: Record<ApplicationStatus, string> = {
  submitted: 'bg-sky-100 text-sky-800',
  in_review: 'bg-amber-100 text-amber-800',
  changes_requested: 'bg-violet-100 text-violet-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700',
  withdrawn: 'bg-[#F3F4F6] text-muted-foreground',
};

/**
 * "5 min", "3 hrs", "2 days": how long it has waited since it was sent. Units
 * spelled out — a bare "1m" reads as a month as easily as a minute.
 */
export function waitedFor(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours === 1 ? '1 hr' : `${hours} hrs`;
  return `${Math.floor(hours / 24)} days`;
}

/** "5 min ago", for history entries. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const waited = waitedFor(iso, now);
  return waited === '—' ? '' : `${waited} ago`;
}

/** Past this, a waiting application is flagged in the queue. */
export const SLOW_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

/** What each history entry says, in the console's words. */
export const OPS_EVENT_LABEL: Record<string, string> = {
  submitted: 'Application sent',
  edited: 'Application edited',
  resubmitted: 'Requested changes sent back',
  withdrawn: 'Application withdrawn',
  claimed: 'Picked up for review',
  released: 'Put back in the queue',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
  approved: 'Approved, account opened',
  approve_failed: 'Approval failed, nothing changed',
  finalized: 'Documents and guest orders moved to the account',
  finalize_failed: 'Moving to the account did not finish',
  retry_finalize: 'Retried moving to the account',
  resend_email: 'Asked to send the email again',
  email_sent: 'Email sent',
  email_failed: 'Email not sent',
  document_verified: 'Document marked verified',
};

/** Events the customer causes; their actor_id is always empty. */
export const CUSTOMER_EVENTS: ReadonlySet<string> = new Set(['submitted', 'edited', 'resubmitted', 'withdrawn']);
