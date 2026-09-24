/**
 * Everything that has happened to this application, newest first.
 *
 * Moved verbatim out of `pages/ops/OpsApplicationDetail.tsx`.
 */

import {
  Bot,
  Mail,
  UserCog,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatIst } from '@/lib/orderDetail';
import { CUSTOMER_EVENTS, OPS_EVENT_LABEL, timeAgo } from '@/lib/opsApplications';
import type { OpsApplicationEvent } from '@/hooks/useOpsApplications';
import { docStatus } from './ApplicationDocuments';
import {
  Quote,
  fieldLabel,
  slotLabel,
  strings,
} from './blocks';

// ── History ──────────────────────────────────────────────────────────────────

const FAILED_EVENTS: ReadonlySet<string> = new Set(['approve_failed', 'finalize_failed', 'email_failed']);
const DONE_EVENTS: ReadonlySet<string> = new Set(['approved', 'finalized', 'document_verified']);

function eventActor(ev: OpsApplicationEvent): string {
  if (CUSTOMER_EVENTS.has(ev.event)) return 'Customer';
  if (ev.actor_name) return ev.actor_name;
  if (ev.actor_id) return 'Bombino staff';
  return 'Automatic';
}

function eventMarker(ev: OpsApplicationEvent): { Icon: LucideIcon; tone: string } {
  const Icon: LucideIcon = ev.event.startsWith('email_')
    ? Mail
    : CUSTOMER_EVENTS.has(ev.event)
      ? UserRound
      : ev.actor_id
        ? UserCog
        : Bot;
  if (FAILED_EVENTS.has(ev.event)) return { Icon, tone: 'bg-red-50 text-red-700 border-red-200' };
  if (DONE_EVENTS.has(ev.event)) return { Icon, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (ev.event === 'changes_requested') return { Icon, tone: 'bg-violet-50 text-violet-700 border-violet-200' };
  return { Icon, tone: 'bg-white text-muted-foreground border-border' };
}

function emailKind(kind: unknown): string {
  if (kind === 'received') return 'Application-received email';
  if (kind === 'changes_requested') return 'Changes-needed email';
  if (kind === 'rejected') return 'Not-opened email';
  return 'Account-ready email with the ITD login';
}

/** What happened, beyond the label: what was asked, said, or sent, and to whom. */
function EventDetail({ ev }: { ev: OpsApplicationEvent }) {
  const m = ev.metadata ?? {};
  switch (ev.event) {
    case 'changes_requested': {
      const fields = strings(m.fields).map(fieldLabel);
      const slots = strings(m.slots).map(slotLabel);
      return (
        <>
          {fields.length > 0 && (
            <p className="text-xs text-foreground">
              <span className="text-muted-foreground">Fix: </span>
              {fields.join(', ')}
            </p>
          )}
          {slots.length > 0 && (
            <p className="text-xs text-foreground">
              <span className="text-muted-foreground">Upload again: </span>
              {slots.join(', ')}
            </p>
          )}
          {ev.note && <Quote label="Note sent to the customer">{ev.note}</Quote>}
        </>
      );
    }
    case 'rejected':
      return ev.note ? <Quote label="Reason sent to the customer">{ev.note}</Quote> : null;
    case 'approved': {
      const login = typeof m.itd_email === 'string' ? m.itd_email : null;
      return login ? (
        <p className="text-xs text-foreground">
          <span className="text-muted-foreground">ITD login: </span>
          {login}
        </p>
      ) : null;
    }
    case 'email_sent':
    case 'email_failed': {
      const to = typeof m.to === 'string' ? m.to : null;
      return (
        <>
          <p className="text-xs text-foreground">
            {emailKind(m.kind)}
            {to && <span className="text-muted-foreground"> to {to}</span>}
          </p>
          {ev.event === 'email_failed' && ev.note && <p className="text-xs text-red-700 break-words">{ev.note}</p>}
        </>
      );
    }
    case 'approve_failed':
    case 'finalize_failed':
      return ev.note ? <p className="text-xs text-red-700 break-words">{ev.note}</p> : null;
    case 'document_verified': {
      const slot = typeof m.slot === 'string' ? m.slot : null;
      const previous = typeof m.previous === 'string' ? m.previous : null;
      const cashfree = docStatus({ provided: true, ocr_status: previous }).text;
      return (
        <p className="text-xs text-foreground">
          {slot ? slotLabel(slot) : 'A document'}
          <span className="text-muted-foreground"> · Cashfree: {cashfree.toLowerCase()}</span>
        </p>
      );
    }
    case 'edited':
      return <p className="text-xs text-muted-foreground">Changed their details or documents before anyone picked it up.</p>;
    case 'resubmitted':
      return <p className="text-xs text-muted-foreground">Back in the queue as new.</p>;
    default:
      return ev.note ? <p className="text-xs text-muted-foreground whitespace-pre-wrap">{ev.note}</p> : null;
  }
}

/** An activity feed on the page itself, under the sheet, like any tracker's. */
export function HistorySection({ events }: { events: OpsApplicationEvent[] }) {
  const newestFirst = [...events].reverse();
  const now = Date.now();
  return (
    <section data-testid="ops-application-history">
      <div className="flex items-baseline justify-between gap-3 px-1 mb-4">
        <h2 className="text-base font-extrabold text-foreground">History</h2>
        {events.length > 0 && <p className="text-xs font-medium text-muted-foreground">Newest first</p>}
      </div>
      {newestFirst.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="px-1">
          {newestFirst.map((ev, i) => {
            const marker = eventMarker(ev);
            const last = i === newestFirst.length - 1;
            return (
              <li key={ev.id} className={cn('relative flex gap-3', !last && 'pb-5')}>
                {!last && <span aria-hidden className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />}
                <span
                  className={cn('relative grid place-items-center w-8 h-8 rounded-full border shrink-0', marker.tone)}
                  aria-hidden
                >
                  <marker.Icon className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1 pt-1 space-y-1.5">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{OPS_EVENT_LABEL[ev.event] ?? ev.event}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground/80">{eventActor(ev)}</span>
                      {' · '}
                      <time dateTime={ev.created_at}>{formatIst(ev.created_at)}</time>
                      {timeAgo(ev.created_at, now) && ` · ${timeAgo(ev.created_at, now)}`}
                    </p>
                  </div>
                  <EventDetail ev={ev} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
