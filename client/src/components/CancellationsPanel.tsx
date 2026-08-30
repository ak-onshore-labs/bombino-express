/**
 * The cancellations view inside My Orders.
 *
 * Not its own screen: a cancellation is a thing that happened to an order, so
 * it belongs beside the orders rather than in a separate place in the nav that
 * a customer has to know exists.
 *
 * It earns a tab of its own because a *request* produces no visible change —
 * the order carries on, the agent still comes, and in the main list it looks
 * identical to any other live order. This is where the asking, the waiting and
 * the answer are legible.
 *
 * Deliberately read-only. The decision is ops', taken in their console, and
 * nothing here can hurry it — so the panel's whole job is to say where a
 * request has got to and how to reach a person if that is not fast enough.
 *
 * `cancellation.state` is computed server-side (`cancellationState` in
 * shared/orderContract.ts) and rendered verbatim: a cancelled order outranks
 * whatever its metadata says, and that rule lives in one place.
 */

import { Link } from 'wouter';
import {
  Ban,
  Bot,
  Check,
  ChevronRight,
  Clock,
  MessageCircle,
  PackageX,
  Phone,
  RotateCcw,
} from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatInr } from '@/lib/orderDetail';
import { useCancellations, type CancellationRow } from '@/hooks/useCustomerOrders';
import whatsAppLogo from '@/assets/WhatsApp.svg.png';

const BRAND_NAVY = 'lab(34.0831 -9.57756 -27.7093)';

// Same numbers the side menu and Home already carry — one support identity,
// not a second one invented for this panel.
const SUPPORT_PHONE_HREF = 'tel:+912266400000';
const SUPPORT_PHONE_LABEL = '+91 22 6640 0000';
const SUPPORT_WHATSAPP_HREF = 'https://api.whatsapp.com/send?phone=917045999553';

function niceDateTime(value: string | null): string {
  if (!value) return '';
  const d = parseISO(value.length <= 10 ? `${value}T12:00:00Z` : value);
  return isValid(d) ? format(d, 'd MMM, h:mm a') : '';
}

function niceDate(value: string | null): string {
  if (!value) return '';
  const d = parseISO(value.length <= 10 ? `${value}T12:00:00Z` : value);
  return isValid(d) ? format(d, 'd MMM yyyy') : '';
}

// ─── Progress ───────────────────────────────────────────────────────────────

type StepState = 'done' | 'current' | 'idle';

/**
 * Three steps, because a cancellation only ever has three moments: the customer
 * asked, Bombino looked, Bombino answered. The third step carries the outcome
 * in its label rather than a fourth branch — "Cancelled" and "Declined" are the
 * same position in the flow, not different lengths of it.
 */
function stepsFor(row: CancellationRow): { label: string; state: StepState }[] {
  const state = row.cancellation.state;
  if (state === 'approved') {
    return [
      { label: 'Requested', state: 'done' },
      { label: 'Reviewed', state: 'done' },
      { label: 'Cancelled', state: 'done' },
    ];
  }
  if (state === 'rejected') {
    return [
      { label: 'Requested', state: 'done' },
      { label: 'Reviewed', state: 'done' },
      { label: 'Declined', state: 'current' },
    ];
  }
  return [
    { label: 'Requested', state: 'done' },
    { label: 'With our team', state: 'current' },
    { label: 'Decision', state: 'idle' },
  ];
}

function Progress({ row }: { row: CancellationRow }) {
  const steps = stepsFor(row);
  const isRejected = row.cancellation.state === 'rejected';

  return (
    <div className="flex items-center gap-1.5 mt-3" data-testid="cancellation-progress">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center gap-1.5 flex-1 last:flex-none">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={cn(
                'w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0',
                step.state === 'done' && !isRejected && 'bg-[#2F4468]',
                step.state === 'done' && isRejected && 'bg-[#94A3B8]',
                step.state === 'current' && isRejected && 'bg-red-500',
                step.state === 'current' && !isRejected && 'bg-[#F2A123]',
                step.state === 'idle' && 'bg-muted border border-border',
              )}
            >
              {step.state === 'done' && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
              {step.state === 'current' && isRejected && (
                <Ban className="w-2.5 h-2.5 text-white" strokeWidth={3} />
              )}
              {step.state === 'current' && !isRejected && (
                <Clock className="w-2.5 h-2.5 text-white" strokeWidth={3} />
              )}
            </span>
            <span
              className={cn(
                'text-[10px] font-medium truncate',
                step.state === 'idle' ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <span
              className={cn(
                'h-px flex-1 min-w-2',
                steps[i + 1].state === 'idle' ? 'bg-border' : 'bg-[#2F4468]/30',
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

function CancellationCard({ row }: { row: CancellationRow }) {
  const { state, reason, requestedAt, decidedAt, decisionNote } = row.cancellation;
  const amount = formatInr(row.final_amount ?? row.quoted_amount);

  return (
    <Link
      href={`/order/${encodeURIComponent(row.order_no)}`}
      className="block rounded-xl bg-white border border-border p-4 hover:border-[#2F4468]/30 transition-colors"
      data-testid={`cancellation-card-${row.order_no}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold tabular-nums" style={{ color: BRAND_NAVY }}>
            {row.order_no}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {row.customerStatus}
            {row.pickup_date && ` · Pickup ${niceDate(row.pickup_date)}`}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {amount && (
            <span className="text-sm font-semibold tabular-nums" style={{ color: BRAND_NAVY }}>
              {amount}
            </span>
          )}
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>

      <Progress row={row} />

      {/* What the customer said, and what Bombino said back. Both are quoted
          rather than paraphrased — this is the record of a conversation. */}
      {reason && (
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Your reason: </span>
          {reason}
        </p>
      )}

      {state === 'rejected' && (
        <div className="mt-3 rounded-lg bg-red-50 border border-red-100 p-3">
          <p className="text-xs font-semibold text-red-800">
            Declined{decidedAt ? ` · ${niceDateTime(decidedAt)}` : ''}
          </p>
          <p className="text-xs text-red-700 mt-1 leading-relaxed">
            {decisionNote ?? 'Our team could not cancel this order. It is still going ahead.'}
          </p>
        </div>
      )}

      {state === 'pending' && (
        <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
          Asked {niceDateTime(requestedAt)}. Your shipment continues as booked until our team
          confirms.
        </p>
      )}

      {state === 'approved' && (
        <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
          Cancelled{decidedAt ? ` on ${niceDateTime(decidedAt)}` : ''}. Nothing further will happen
          to this order.
        </p>
      )}
    </Link>
  );
}

function Group({ title, hint, rows }: { title: string; hint: string; rows: CancellationRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6 first:mt-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold" style={{ color: BRAND_NAVY }}>
          {title}
        </h2>
        <span className="text-[11px] text-muted-foreground tabular-nums">{rows.length}</span>
      </div>
      <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>
      <div className="space-y-3 mt-3">
        {rows.map((row) => (
          <CancellationCard key={row.id} row={row} />
        ))}
      </div>
    </section>
  );
}

/**
 * The way out of a view that cannot do anything for you.
 *
 * Placed after the list, not before it: a customer who came to check on a
 * request should see the answer first, and reach for a phone only if the answer
 * is not there.
 */
function ContactTeam() {
  return (
    <section
      className="mt-8 rounded-xl border border-border bg-white p-4"
      data-testid="contact-team"
    >
      <h2 className="text-sm font-semibold" style={{ color: BRAND_NAVY }}>
        Contact the Bombino team
      </h2>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
        Cancellations are reviewed by a person, not a system. Call us if a request is urgent or if
        you disagree with a decision.
      </p>

      <div className="mt-4 space-y-2">
        <a
          href={SUPPORT_PHONE_HREF}
          className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors"
          data-testid="link-call-support"
        >
          <span className="w-9 h-9 rounded-lg bg-[#2F4468]/8 flex items-center justify-center flex-shrink-0">
            <Phone className="w-4 h-4 text-[#2F4468]" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">Call support</span>
            <span className="block text-xs text-muted-foreground tabular-nums mt-0.5">
              {SUPPORT_PHONE_LABEL} · Mon–Sat, 9 AM – 7 PM
            </span>
          </span>
        </a>

        <a
          href={SUPPORT_WHATSAPP_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors"
          data-testid="link-whatsapp-support"
        >
          <span className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
            <img src={whatsAppLogo} alt="" className="w-4 h-4 object-contain" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">WhatsApp support</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              Send your order number and we will pick it up from there
            </span>
          </span>
        </a>

        <Link
          href="/help"
          className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors"
          data-testid="link-ask-bia"
        >
          <span className="w-9 h-9 rounded-lg bg-[#F2A123]/12 flex items-center justify-center flex-shrink-0">
            <Bot className="w-4 h-4 text-[#F2A123]" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">Ask BIA</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              Answers about charges, timelines and what happens next
            </span>
          </span>
        </Link>
      </div>
    </section>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────

export function CancellationsPanel({ enabled = true }: { enabled?: boolean }) {
  const { data, isLoading, error } = useCancellations(enabled);

  const rows = data ?? [];
  const pending = rows.filter((r) => r.cancellation.state === 'pending');
  const rejected = rows.filter((r) => r.cancellation.state === 'rejected');
  const cancelled = rows.filter((r) => r.cancellation.state === 'approved');

  return (
    <div data-testid="panel-cancellations">
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-800">Could not load your cancellations</p>
          <p className="text-xs text-red-700 mt-1">
            {error instanceof Error ? error.message : 'Please try again.'}
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-white p-8 text-center">
          <PackageX className="w-8 h-8 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium mt-3">No cancellations</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-xs mx-auto">
            You can ask us to cancel an order from its own page, up until an agent collects the
            parcel.
          </p>
        </div>
      ) : (
        <>
          <Group
            title="Awaiting our decision"
            hint="Still going ahead until the team confirms."
            rows={pending}
          />
          <Group title="Declined" hint="These shipments are continuing as booked." rows={rejected} />
          <Group
            title="Cancelled"
            hint="Closed. Nothing further happens on these orders."
            rows={cancelled}
          />
        </>
      )}

      {rejected.length > 0 && (
        <p className="mt-6 flex items-start gap-2 text-[11px] text-muted-foreground leading-relaxed">
          <RotateCcw className="w-3.5 h-3.5 mt-px flex-shrink-0" />
          A declined request can be raised again from the order's own page while the parcel is still
          with you.
        </p>
      )}

      <ContactTeam />

      <p className="mt-4 flex items-start gap-2 text-[11px] text-muted-foreground leading-relaxed">
        <MessageCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
        Refunds on a cancelled prepaid order are handled by our team over the phone.
      </p>
    </div>
  );
}
