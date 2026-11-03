import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { Link } from 'wouter';
import {
  AlertTriangle,
  Ban,
  Bike,
  CalendarDays,
  FileText,
  MapPin,
  Phone,
  Store,
  type LucideIcon,
} from 'lucide-react';
import { todayInIst } from '@shared/istTime';
import { OpsSenderCell } from '@/components/ops/OpsSenderCell';
import { TestBadge } from '@/components/ops/TestBadge';
import { getOrderStatusLabel } from '@/lib/orderStatus';
import { formatInr } from '@/lib/orderDetail';
import { cn } from '@/lib/utils';
import type { OpsAgentCancellation, OpsBoardOrder } from '@/hooks/useOpsOrders';

/** Where the agent was when they cancelled, as the branch would say it. */
const CANCELLED_AT: Record<string, string> = {
  agent_accepted: 'before setting off',
  out_for_pickup: 'on the way',
};

/**
 * One short line on an agent's cancellation: when in the job it happened, and
 * what the branch does next. Short because the card truncates it on a phone.
 */
export function agentCancelLine(c: OpsAgentCancellation): string {
  const when = CANCELLED_AT[c.from_status] ?? 'mid-pickup';
  return `Cancelled ${when} · assign again`;
}

/** Still waiting for the parcel to leave the customer — the date can go stale. */
const BEFORE_COLLECTION = new Set([
  'pickup_requested',
  'agent_accepted',
  'out_for_pickup',
  'awaiting_dropoff',
]);

/** Pickup stages where who has the job is the thing a branch watches. */
const AGENT_STAGES = new Set([
  'pickup_requested',
  'agent_accepted',
  'out_for_pickup',
  'picked_up',
]);

/** The parcel's journey through the branch, as the progress bar shows it. */
const JOURNEY = ['Booked', 'Collected', 'At hub', 'Settled', 'Dispatched'] as const;

/** How many journey steps an order has reached (1–5); 0 when cancelled. */
const JOURNEY_STEP: Record<string, number> = {
  pickup_requested: 1,
  agent_accepted: 1,
  out_for_pickup: 1,
  awaiting_dropoff: 1,
  picked_up: 2,
  received_at_hub: 3,
  weighed: 3,
  settled: 4,
  ready_for_docket: 4,
  dispatched: 5,
  cancelled: 0,
};

type Day = { text: string; late: boolean };

/** `Today` / `Tomorrow` / `12 Oct`, or `2 days late` once the date has passed uncollected. */
export function dayFor(order: OpsBoardOrder, today: string): Day | null {
  const date = order.pickup_date;
  if (!date) return null;
  const diff = Math.round(
    (new Date(`${date}T00:00:00Z`).getTime() -
      new Date(`${today}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (BEFORE_COLLECTION.has(order.status) && diff < 0) {
    const n = -diff;
    return { text: n === 1 ? '1 day late' : `${n} days late`, late: true };
  }
  if (diff === 0) return { text: 'Today', late: false };
  if (diff === 1) return { text: 'Tomorrow', late: false };
  const text = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return { text, late: false };
}

/** Money: what the agent must collect, what is still owed, or settled. */
function moneyFor(order: OpsBoardOrder): { label: string; text: string; owed: boolean } | null {
  const amount = formatInr(order.final_amount) ?? formatInr(order.quoted_amount);
  const cod = order.is_cod || order.payment_method === 'cod';
  if (cod && order.payment_status !== 'paid') {
    return { label: 'Collect cash (COD)', text: amount ?? '—', owed: true };
  }
  if (order.payment_status !== 'paid') {
    return { label: 'Unpaid', text: amount ?? '—', owed: true };
  }
  return { label: 'Paid', text: amount ?? '—', owed: false };
}

/** Account holder or guest — whoever the branch would ring about this parcel. */
function contactPhone(order: OpsBoardOrder): string | null {
  const phone = order.user_id ? order.customer_phone : order.guest_phone;
  return phone?.trim() || null;
}

/**
 * Tap-to-call inside the card's link. A real `<a href="tel:">` cannot nest in
 * the card's `<a>`, so this is a button-role span that dials and stops the tap
 * from opening the order.
 */
function CallButton({ phone, orderNo }: { phone: string; orderNo: string }) {
  const dial = (event: MouseEvent | KeyboardEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    window.location.href = `tel:${phone.replace(/\s+/g, '')}`;
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Call ${phone}`}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-white text-foreground active:bg-muted"
      onClick={dial}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') dial(event);
      }}
      data-testid={`ops-order-call-${orderNo}`}
    >
      <Phone className="w-5 h-5" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/** Five segments, filled up to where the parcel is. Grey throughout when cancelled. */
export function JourneyBar({ status, orderNo }: { status: string; orderNo: string }) {
  const step = JOURNEY_STEP[status] ?? 1;
  return (
    <div
      className="mt-3 flex gap-1"
      role="img"
      aria-label={step ? `Step ${step} of ${JOURNEY.length}: ${JOURNEY[step - 1]}` : 'Cancelled'}
      data-testid={`ops-order-journey-${orderNo}`}
    >
      {JOURNEY.map((name, i) => (
        <span
          key={name}
          className={cn('h-1.5 flex-1 rounded-full', i < step ? 'bg-foreground' : 'bg-muted')}
        />
      ))}
    </div>
  );
}

/** Icon and text, nothing else — the icon is the label. */
function Row({
  icon: Icon,
  label,
  children,
  alert = false,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  alert?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 text-sm',
        alert ? 'font-bold text-destructive' : 'font-semibold text-foreground',
      )}
      data-testid={testId}
    >
      <Icon
        className={cn('w-4 h-4 shrink-0', alert ? 'text-destructive' : 'text-muted-foreground')}
        strokeWidth={1.75}
        aria-label={label}
      />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

/**
 * One order on the ops board, built for a branch manager scanning on a phone.
 *
 * One white surface, read top to bottom: where the parcel is in its journey
 * (status headline + five-step bar), who to call, where and when, who has it,
 * then money under the only divider. The US receiver and booking timestamp
 * live on the order page, not here.
 *
 * Red is a problem the branch must act on (late, no agent, AWB failed): a pill
 * beside the order number and the matching row in red. Amber is money.
 */
export function OpsOrderCard({ order }: { order: OpsBoardOrder }) {
  const dropoff = order.pickup_request === 2;
  const day = dayFor(order, todayInIst());
  const money = moneyFor(order);
  const showAgent = !dropoff && AGENT_STAGES.has(order.status);
  const noAgent = showAgent && !order.agent_id;
  const late = Boolean(day?.late);
  const phone = contactPhone(order);
  const cancelled = order.status === 'cancelled';
  const place = [order.pickup_area || 'No address', order.pickup_pincode]
    .filter(Boolean)
    .join(', ');
  const agentCancel = order.agent_cancellation?.open ? order.agent_cancellation : null;
  // The one problem worth a flag up top; the rows below say the detail. An
  // agent's cancellation first: it is the newest news and needs a call.
  const issue = agentCancel
    ? 'Agent cancelled'
    : late
      ? 'Late'
      : noAgent
        ? 'No agent'
        : order.docket_error
          ? 'AWB issue'
          : null;

  return (
    <Link
      href={`/ops/orders/${order.id}`}
      className="ops-press block rounded-md border border-border bg-white p-4"
      data-testid={`ops-order-card-${order.order_no}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
          {order.order_no}
          <span className="font-medium"> · {dropoff ? 'Drop-off' : 'Pickup'}</span>
          {order.is_test && <TestBadge className="ml-1.5 align-middle" />}
        </span>
        {issue && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-1 text-[11px] font-bold leading-none text-destructive"
            data-testid={`ops-order-issue-${order.order_no}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />
            {issue}
          </span>
        )}
      </div>

      <p
        className={cn(
          'mt-1.5 text-lg font-extrabold leading-tight',
          cancelled ? 'text-muted-foreground line-through' : 'text-foreground',
        )}
        data-testid={`ops-order-status-${order.order_no}`}
      >
        {getOrderStatusLabel(order.status)}
      </p>
      <JourneyBar status={order.status} orderNo={order.order_no} />

      <div className="mt-4 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold leading-tight text-foreground">
            <OpsSenderCell order={order} nested />
          </p>
          <p className="mt-0.5 text-sm font-medium text-muted-foreground tabular-nums">
            {phone ?? 'No phone on file'}
          </p>
        </div>
        {phone && <CallButton phone={phone} orderNo={order.order_no} />}
      </div>

      <div className="mt-3 space-y-2">
        {agentCancel && (
          <Row
            icon={Ban}
            label="Agent cancelled"
            alert
            testId={`ops-agent-cancelled-${order.order_no}`}
          >
            {agentCancelLine(agentCancel)}
          </Row>
        )}
        <div className="flex items-center justify-between gap-3">
          <Row
            icon={dropoff ? Store : MapPin}
            label={dropoff ? 'Drop-off from' : 'Pickup at'}
            testId={`ops-order-area-${order.order_no}`}
          >
            {place}
          </Row>
          {day && (
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 text-sm tabular-nums',
                day.late ? 'font-bold text-destructive' : 'font-semibold text-foreground',
              )}
              data-testid={`ops-order-day-${order.order_no}`}
            >
              <CalendarDays
                className={cn('w-4 h-4', day.late ? 'text-destructive' : 'text-muted-foreground')}
                strokeWidth={1.75}
                aria-label="Date"
              />
              {day.text}
            </span>
          )}
        </div>
        {showAgent && (
          <Row
            icon={Bike}
            label="Agent"
            alert={noAgent}
            testId={`ops-agent-badge-${order.order_no}`}
          >
            {noAgent ? 'No agent yet' : order.agent_name || 'Assigned'}
          </Row>
        )}
        {order.awb_no && (
          <Row icon={FileText} label="AWB">
            AWB {order.awb_no}
          </Row>
        )}
        {/* This order was meant to carry an AWB from the moment it was booked
            and does not. Without saying so it looks exactly like an ordinary
            pre-docket booking, and nobody goes looking. */}
        {order.docket_error && (
          <Row
            icon={AlertTriangle}
            label="AWB problem"
            alert
            testId={`ops-docket-failed-${order.order_no}`}
          >
            {order.docket_retry === 'auto'
              ? 'AWB retrying'
              : order.docket_retry === 'check_itd'
                ? 'AWB: check ITD'
                : 'AWB failed'}
          </Row>
        )}
      </div>

      {money && (
        <div
          className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3"
          data-testid={`ops-order-money-${order.order_no}`}
        >
          <span className="text-sm font-medium text-muted-foreground">{money.label}</span>
          <span
            className={cn(
              'text-base font-extrabold tabular-nums',
              money.owed ? 'text-[#F2A123]' : 'text-foreground',
            )}
          >
            {money.text}
          </span>
        </div>
      )}
    </Link>
  );
}
