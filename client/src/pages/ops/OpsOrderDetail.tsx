import { useEffect, useState, type ReactNode } from 'react';
import { formatInr, formatIst } from '@/lib/orderDetail';
import { signOutAndRedirect } from '@/lib/session';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Bike, CalendarDays, Loader2, LogOut, Phone } from 'lucide-react';
import { useLocation, useParams, useSearch } from 'wouter';
import { OpsActionBar } from '@/components/ops/OpsActionBar';
import { OpsAssignAgentPanel } from '@/components/ops/OpsAssignAgentPanel';
import { JourneyBar, dayFor } from '@/components/ops/OpsOrderCard';
import { OpsSenderCell } from '@/components/ops/OpsSenderCell';
import { OpsShell } from '@/components/ops/OpsShell';
import { PdfDocButton, fetchPdfBase64 } from '@/components/PdfDocButton';
import { OpsCollectPaymentSheet } from '@/components/ops/OpsCollectPaymentSheet';
import { OpsDropoffOtpSheet } from '@/components/ops/OpsDropoffOtpSheet';
import { OpsWeighSheet } from '@/components/ops/OpsWeighSheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { TestBadge } from '@/components/ops/TestBadge';
import { OpsTestMarkControl } from '@/components/ops/OpsTestMarkControl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  opsOrderDetailKey,
  useOpsOrderAction,
  useOpsOrderDetail,
  type OpsActionError,
  type OpsAgentCancellation,
  type OpsOrderDetail as OpsOrderDetailData,
  type OpsOrderEvent,
} from '@/hooks/useOpsOrders';
import { getOrderStatusLabel } from '@/lib/orderStatus';
import { useCan } from '@/lib/opsAccess';
import { cn } from '@/lib/utils';
import { todayInIst } from '@shared/istTime';

function Fact({
  label,
  value,
  span = false,
}: {
  label: string;
  value: ReactNode;
  span?: boolean;
}) {
  return (
    <div className={span ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-foreground break-words">
        {value ?? '—'}
      </p>
    </div>
  );
}

/** One group of facts: a titled card, two columns even on a phone. */
function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-white">
      <h2 className="px-4 pt-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 pt-2 pb-4">{children}</div>
    </section>
  );
}

/** The shared helpers answer '—' for nothing; these keep this page's wording. */
const formatMoney = (value: number | null | undefined): string => formatInr(value) ?? '—';
const formatWhen = (iso: string): string => formatIst(iso);

/** Where the agent is with the job, as the branch would say it. */
const AGENT_STAGE: Record<string, string> = {
  pickup_requested: 'Waiting for an agent',
  agent_accepted: 'Assigned, not set off yet',
  out_for_pickup: 'On the way to the customer',
  picked_up: 'Has the parcel, bringing it to the hub',
  received_at_hub: 'Handed over at the hub',
};

/**
 * The pickup agent: who, their number, where they are with the job and when
 * they were given it. Calling the agent is what a branch does most with a
 * live pickup, so the number is a button.
 */
function AgentCard({ order, events }: { order: OpsOrderDetailData; events: OpsOrderEvent[] }) {
  const assigned = [...events]
    .reverse()
    .find((e) => (e.metadata as { action?: unknown } | null)?.action === 'assign');
  const name = order.agent_name?.trim() || null;
  const phone = order.agent_phone?.trim() || null;
  const stage = AGENT_STAGE[order.status] ?? null;

  return (
    <InfoCard title="Pickup agent">
      {order.agent_id ? (
        <>
          <div className="col-span-2 flex items-center gap-3" data-testid="ops-order-agent">
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-base font-bold text-foreground"
              aria-hidden
            >
              {(name ?? 'A').charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold text-foreground">{name ?? 'Agent'}</p>
              <p className="mt-0.5 text-sm font-medium text-muted-foreground tabular-nums">
                {phone ?? 'No phone on file'}
              </p>
            </div>
            {phone && (
              <a
                href={`tel:${phone.replace(/\s+/g, '')}`}
                aria-label={`Call ${name ?? 'agent'}`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-white text-foreground hover:bg-muted"
                data-testid="ops-order-call-agent"
              >
                <Phone className="w-5 h-5" strokeWidth={1.75} />
              </a>
            )}
          </div>
          {stage && <Fact label="Now" value={stage} />}
          <Fact label="Assigned" value={assigned ? formatWhen(assigned.created_at) : '—'} />
        </>
      ) : (
        <p className="col-span-2 text-sm font-bold text-destructive" data-testid="ops-order-no-agent">
          No agent yet
        </p>
      )}
    </InfoCard>
  );
}

/** Where the agent was when they cancelled. */
const CANCELLED_AT: Record<string, string> = {
  agent_accepted: 'before setting off',
  out_for_pickup: 'on the way to the customer',
};

/**
 * An agent cancelled this pickup. First thing on the page while the branch
 * still has to act — red, with the agent's number — and a plain line in the
 * order's story once it is dealt with.
 */
function AgentCancelNotice({ cancel }: { cancel: OpsAgentCancellation }) {
  const who = cancel.agent_name?.trim() || 'The agent';
  const when = CANCELLED_AT[cancel.from_status] ?? 'during the pickup';
  const at = formatWhen(cancel.at);

  if (!cancel.open) {
    return (
      <p
        className="mb-4 rounded-md border border-border bg-white px-4 py-3 text-sm text-muted-foreground"
        data-testid="ops-agent-cancel-past"
      >
        {who} cancelled this pickup {when}, {at}.
      </p>
    );
  }

  return (
    <section
      className="mb-4 rounded-md border border-destructive bg-destructive/10 p-4"
      data-testid="ops-agent-cancel"
    >
      <div className="flex items-center gap-2 text-destructive">
        <Ban className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        <h2 className="text-base font-extrabold">Agent cancelled this pickup</h2>
      </div>
      <p className="mt-1.5 text-sm font-semibold leading-snug text-foreground">
        {who} cancelled {when}, {at}.
      </p>
      <p className="mt-1 text-sm leading-snug text-foreground">
        The parcel was not collected. Assign another agent below.
      </p>
      {cancel.agent_phone && (
        <a
          href={`tel:${cancel.agent_phone.replace(/\s+/g, '')}`}
          className="mt-3 inline-flex h-11 items-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-bold text-foreground hover:bg-muted"
          data-testid="ops-agent-cancel-call"
        >
          <Phone className="h-4 w-4" strokeWidth={1.75} />
          Call {who === 'The agent' ? 'agent' : who} · {cancel.agent_phone}
        </a>
      )}
    </section>
  );
}

function consigneeLines(consignee: unknown): { name: string; city: string; phone: string } {
  if (!consignee || typeof consignee !== 'object' || Array.isArray(consignee)) {
    return { name: '—', city: '—', phone: '—' };
  }
  const c = consignee as Record<string, unknown>;
  const str = (k: string) =>
    typeof c[k] === 'string' && (c[k] as string).trim() !== ''
      ? (c[k] as string).trim()
      : '—';
  return {
    name: str('name') !== '—' ? str('name') : str('full_name'),
    city: str('city') !== '—' ? str('city') : str('consignee_city'),
    phone: str('phone'),
  };
}

/**
 * Ops order detail + event timeline + lifecycle actions.
 */
export default function OpsOrderDetail() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, error, isError } = useOpsOrderDetail(orderId);

  // Arrived from "Scan to receive" on a board: bring the receive step into
  // view and mark it for a moment, so the counter does not hunt for it.
  const fromScan = new URLSearchParams(useSearch()).get('scan') === 'receive';
  const [scanFocus, setScanFocus] = useState(false);
  useEffect(() => {
    if (!fromScan || !data) return;
    const target = document.querySelector('[data-testid="ops-order-actions"]');
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setScanFocus(true);
    const t = setTimeout(() => setScanFocus(false), 2500);
    return () => clearTimeout(t);
  }, [fromScan, data]);
  const action = useOpsOrderAction(orderId);
  // Customer support and accounts see the order but never move it.
  const canAct = useCan('orders.act');
  const canAssign =
    canAct &&
    data?.order.pickup_request === 1 &&
    data.order.status === 'pickup_requested' &&
    !data.order.agent_id;

  const [weighOpen, setWeighOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [dropoffOpen, setDropoffOpen] = useState(false);
  const [dropoffError, setDropoffError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ txnId: string | null; amount: number } | null>(
    null,
  );
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  // Enter AWB from ITD portal: the number ops filed by hand.
  const [awbOpen, setAwbOpen] = useState(false);
  const [awbValue, setAwbValue] = useState('');
  const [awbError, setAwbError] = useState<string | null>(null);

  const forbidden =
    isError &&
    error instanceof Error &&
    error.message.startsWith('403:');

  const handleLogout = (): Promise<void> => signOutAndRedirect(setLocation);

  // Back to wherever the order was opened from (a board, a customer, the
  // dashboard). Opened straight from a link, there is nothing behind it.
  const goBack = (): void => {
    if (window.history.length > 1) window.history.back();
    else setLocation('/ops');
  };

  const runAction = (actionName: string, payload?: Record<string, unknown>): void => {
    setPendingAction(actionName);
    if (actionName === 'mark_received_dropoff') {
      setDropoffError(null);
    }
    action.mutate(
      { action: actionName, payload },
      {
        onSuccess: (result) => {
          setPendingAction(null);
          if (result.receipt) {
            setReceipt(result.receipt);
            return;
          }
          setWeighOpen(false);
          setCollectOpen(false);
          setDropoffOpen(false);
          setDropoffError(null);
          setAwbOpen(false);
          toast({
            title: 'Updated',
            description: `${result.order.order_no} — ${getOrderStatusLabel(result.order.status)}`,
          });
        },
        onError: (err: OpsActionError) => {
          setPendingAction(null);
          if (actionName === 'record_awb') {
            setAwbError(err.message);
            return;
          }
          // A failed filing writes its reason onto the order: show it.
          if (actionName === 'generate_docket' || actionName === 'retry_docket') {
            void queryClient.invalidateQueries({ queryKey: opsOrderDetailKey(orderId) });
            toast({ title: 'AWB not issued', description: err.message, variant: 'destructive' });
            return;
          }
          const isOtpError =
            actionName === 'mark_received_dropoff' &&
            typeof err.code === 'string' &&
            err.code.startsWith('OTP_');
          if (isOtpError) {
            setDropoffError(err.message);
            return;
          }
          if (actionName === 'mark_received_dropoff') {
            setDropoffOpen(false);
            setDropoffError(null);
          }
          const isRetryReprice = err.code === 'RETRY_REPRICE';
          toast({
            title: isRetryReprice
              ? 'Could not reprice'
              : err.status === 409
                ? 'Order moved on'
                : 'Could not update',
            description: isRetryReprice
              ? err.message ||
                'Reprice failed. The order was not changed — fix rates inputs or try again.'
              : err.message,
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleAction = (actionName: string): void => {
    if (actionName === 'weigh') {
      setWeighOpen(true);
      return;
    }
    if (actionName === 'collect_payment') {
      setReceipt(null);
      setCollectOpen(true);
      return;
    }
    if (actionName === 'mark_received_dropoff') {
      setDropoffError(null);
      setDropoffOpen(true);
      return;
    }
    if (actionName === 'settle') {
      if (!window.confirm('Settle this order?')) return;
    }
    if (actionName === 'record_awb') {
      setAwbValue('');
      setAwbError(null);
      setAwbOpen(true);
      return;
    }
    if (actionName === 'generate_docket' || actionName === 'retry_docket') {
      // A real ITD shipment, and ITD cannot amend one once filed.
      if (!window.confirm('File a real ITD docket for this order now? ITD cannot change it afterwards.')) return;
    }
    runAction(actionName);
  };

  if (forbidden) {
    return (
      <OpsShell title="Order" subtitle="Access required">
        <div className="rounded-md border border-border bg-white p-6 text-center">
          <p className="text-base font-semibold">Ops access required</p>
          <Button
            type="button"
            onClick={() => void handleLogout()}
            className="mt-5 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] font-semibold"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </Button>
        </div>
      </OpsShell>
    );
  }

  if (isLoading) {
    return (
      <OpsShell title="Order" subtitle="Loading">
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </OpsShell>
    );
  }

  if (isError || !data) {
    const notFound =
      error instanceof Error && error.message.startsWith('404:');
    return (
      <OpsShell title="Order" subtitle={notFound ? 'Not found' : 'Error'}>
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1 text-sm font-semibold text-[#F2A123] mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <p className="text-sm text-muted-foreground">
          {notFound ? 'That order could not be found.' : 'Could not load this order.'}
        </p>
      </OpsShell>
    );
  }

  const { order, events, handover } = data;
  // One way to an AWB is offered, whichever fits the customer: a real filing
  // on their own ITD login, or ops entering one filed in ITD's portal. A test
  // order always takes Generate docket, which gives it a test AWB.
  const filesItself = data.owner_has_itd_login || order.is_test === true;
  const availableActions = data.availableActions.filter((a) =>
    filesItself ? a.action !== 'record_awb' : a.action !== 'generate_docket'
  );
  const docketRetryLabel =
    order.docket_retry === 'auto'
      ? 'Retrying automatically'
      : order.docket_retry === 'check_itd'
        ? 'Check ITD portal first'
        : 'Needs ops';
  const consignee = consigneeLines(order.consignee);
  const dueAmount = order.final_amount ?? order.quoted_amount ?? 0;
  const dropoff = order.pickup_request === 2;
  const day = dayFor(order, todayInIst());
  const agentCancel = order.agent_cancellation ?? null;
  const issue = agentCancel?.open
    ? 'Agent cancelled'
    : day?.late
    ? 'Late'
    : !dropoff && order.status === 'pickup_requested' && !order.agent_id
      ? 'No agent'
      : order.docket_error && !order.awb_no
        ? 'AWB issue'
        : null;
  const senderPhone =
    (order.user_id ? order.customer_phone : order.guest_phone)?.trim() || null;

  return (
    <OpsShell title={order.order_no} subtitle={getOrderStatusLabel(order.status)} wide>
      <button
        type="button"
        onClick={goBack}
        className="inline-flex min-h-11 items-center gap-1 -ml-1 px-1 text-sm font-semibold text-muted-foreground hover:text-foreground mb-1"
        data-testid="link-ops-back-board"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      {/* Desktop: the order and what to do on the left, its history on the
          right. Phones: one column, history last. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-8 lg:items-start">
      <div className="min-w-0">

      {data.can_mark_test && (
        <OpsTestMarkControl orderId={order.id} isTest={order.is_test === true} awbNo={order.awb_no ?? null} />
      )}

      {agentCancel && <AgentCancelNotice cancel={agentCancel} />}

      {/* Where the order stands, in one look: status, journey, date, agent. */}
      <section
        className="mb-4 rounded-md border border-border bg-white p-4"
        data-testid="ops-order-summary"
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
              data-testid="ops-order-issue"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />
              {issue}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-xl font-extrabold leading-tight text-foreground">
          {getOrderStatusLabel(order.status)}
        </p>
        <JourneyBar status={order.status} orderNo={order.order_no} />
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {day && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 tabular-nums',
                day.late ? 'font-bold text-destructive' : 'font-semibold text-foreground',
              )}
            >
              <CalendarDays
                className={cn('w-4 h-4', day.late ? 'text-destructive' : 'text-muted-foreground')}
                strokeWidth={1.75}
                aria-label="Date"
              />
              {day.text}
            </span>
          )}
          {!dropoff && (
            <span
              className={cn(
                'inline-flex min-w-0 items-center gap-1.5',
                order.agent_id ? 'font-semibold text-foreground' : 'font-bold text-destructive',
              )}
            >
              <Bike
                className={cn('w-4 h-4 shrink-0', order.agent_id ? 'text-muted-foreground' : 'text-destructive')}
                strokeWidth={1.75}
                aria-label="Agent"
              />
              <span className="truncate">
                {order.agent_id ? order.agent_name?.trim() || 'Assigned' : 'No agent yet'}
              </span>
            </span>
          )}
        </div>
      </section>

      {/* Nothing moves until someone has the pickup, so assigning comes first. */}
      {canAssign && <OpsAssignAgentPanel orderId={order.id} />}

      {/* An AWB this order was supposed to have and does not, why, and who acts
          next (server/docketFiling.ts): the automatic retry, ops after a
          correction, or a check of ITD's portal before filing again. */}
      {!order.awb_no && order.docket_error && (
        <div
          className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 mb-4"
          data-testid="ops-order-docket-error"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-destructive">
              Airway bill not issued
            </p>
            <span
              className="shrink-0 rounded-full border border-destructive/40 bg-white px-2 py-0.5 text-[11px] font-semibold text-destructive"
              data-testid="ops-order-docket-retry"
            >
              {docketRetryLabel}
            </span>
          </div>
          <p className="text-sm font-semibold text-foreground mt-1 leading-snug break-words">
            {order.docket_error}
          </p>
          {order.docket_error_problems && order.docket_error_problems.length > 0 && (
            <ul className="mt-1.5 list-disc pl-5 text-sm text-foreground space-y-0.5" data-testid="ops-order-docket-problems">
              {order.docket_error_problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {order.docket_error_hint && (
            <p className="text-xs text-foreground mt-1.5 leading-relaxed" data-testid="ops-order-docket-hint">
              {order.docket_error_hint}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            The order itself is unaffected.
          </p>
        </div>
      )}

      {availableActions.length > 0 && (
        <section
          className={`mb-4 rounded-md border border-border bg-white p-4 transition-shadow duration-300 ${scanFocus ? 'ring-4 ring-[#F2A123]/40' : ''}`}
          data-testid="ops-order-actions"
        >
          <h2 className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-3">
            Next step
          </h2>
          <OpsActionBar
            actions={availableActions}
            onAction={handleAction}
            pendingAction={pendingAction}
            disabled={action.isPending}
            orderNo={order.order_no}
          />
        </section>
      )}

      <div className="space-y-4 mb-6" data-testid="ops-order-facts">
        <InfoCard title={order.user_id ? 'Customer' : 'Sender (guest)'}>
          <div className="col-span-2 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold text-foreground">
                <OpsSenderCell order={order} context="detail" />
              </p>
              <p className="mt-0.5 text-sm font-medium text-muted-foreground tabular-nums">
                {senderPhone ?? 'No phone on file'}
              </p>
              {!order.user_id && order.guest_email?.trim() && (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {order.guest_email.trim()}
                </p>
              )}
            </div>
            {senderPhone && (
              <a
                href={`tel:${senderPhone.replace(/\s+/g, '')}`}
                aria-label={`Call ${senderPhone}`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-white text-foreground hover:bg-muted"
                data-testid="ops-order-call-sender"
              >
                <Phone className="w-5 h-5" strokeWidth={1.75} />
              </a>
            )}
          </div>
        </InfoCard>

        {!dropoff && <AgentCard order={order} events={events} />}

        <InfoCard title={dropoff ? 'Drop-off' : 'Pickup'}>
          <Fact
            span
            label={dropoff ? 'Sender address' : 'Pickup address'}
            value={order.pickup_address || 'No address on file'}
          />
          <Fact
            label="Date"
            value={
              order.pickup_date
                ? new Date(`${order.pickup_date}T00:00:00Z`).toLocaleDateString('en-IN', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    timeZone: 'UTC',
                  })
                : '—'
            }
          />
          <Fact label="Booked weight" value={order.booked_weight != null ? `${order.booked_weight} kg` : '—'} />
          {order.packaging_required && <Fact span label="Packaging" value="Customer asked for packaging" />}
        </InfoCard>

        <InfoCard title="Payment">
          <Fact
            label="Method"
            value={
              order.is_cod
                ? 'Cash on pickup (COD)'
                : `${order.payment_method.replace(/_/g, ' ')} · ${order.payment_status}`
            }
          />
          <Fact
            label={order.payment_status === 'paid' ? 'Paid' : 'Due'}
            value={
              <span className={order.payment_status === 'paid' ? undefined : 'text-[#F2A123] font-extrabold'}>
                {formatMoney(order.final_amount ?? order.quoted_amount)}
              </span>
            }
          />
          <Fact label="Quoted" value={formatMoney(order.quoted_amount)} />
          <Fact label="Final (after weighing)" value={formatMoney(order.final_amount)} />
          <Fact label="Actual weight" value={order.actual_weight != null ? `${order.actual_weight} kg` : 'Not weighed'} />
          <Fact label="AWB" value={order.awb_no ?? '—'} />
        </InfoCard>

        <InfoCard title="Receiver (USA)">
          <Fact label="Name" value={consignee.name} />
          <Fact label="City" value={consignee.city} />
          <Fact span label="Phone" value={consignee.phone} />
        </InfoCard>

        {/* Booked without an ITD login (a guest, or an account we hold no ITD
            password for): the box goes out with our QR label, not an AWB. The
            counter can print one for a box that arrived without it. */}
        {!order.awb_no && order.status !== 'cancelled' && (!order.user_id || !data.owner_has_itd_login) && (
          <div
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-white px-4 py-3"
            data-testid="ops-order-box-label"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Box label (QR)</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                For a box that arrived without one.
              </p>
            </div>
            <PdfDocButton
              text="Print"
              title="Box label"
              fileName={`${order.order_no}-box-label.pdf`}
              testId="button-ops-box-label"
              fetchBase64={() =>
                fetchPdfBase64(
                  `/api/ops/orders/${encodeURIComponent(order.id)}/box-label`,
                  'boxLabel',
                  'Box label',
                  toast
                )
              }
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground tabular-nums">
          Booked {formatWhen(order.created_at)}
        </p>
      </div>
      </div>

      <Dialog open={awbOpen} onOpenChange={(open) => !action.isPending && setAwbOpen(open)}>
        <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md rounded-md">
          <DialogHeader>
            <DialogTitle>Enter AWB from ITD portal</DialogTitle>
            <DialogDescription>
              This customer has no ITD login of their own. File the docket in ITD's portal, then enter
              the AWB it gave you. The order moves to Dispatched.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAwbError(null);
              runAction('record_awb', { awb_no: awbValue.trim() });
            }}
          >
            <Label htmlFor="ops-awb-input">AWB</Label>
            <Input
              id="ops-awb-input"
              value={awbValue}
              onChange={(e) => setAwbValue(e.target.value)}
              autoFocus
              autoComplete="off"
              className="mt-1.5 font-mono"
              aria-invalid={awbError ? true : undefined}
              aria-describedby={awbError ? 'ops-awb-error' : undefined}
              data-testid="input-ops-awb"
            />
            {awbError && (
              <p id="ops-awb-error" className="mt-1.5 text-sm text-destructive" role="alert">
                {awbError}
              </p>
            )}
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setAwbOpen(false)} disabled={action.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={action.isPending || awbValue.trim().length < 6} data-testid="button-ops-awb-save">
                {action.isPending && pendingAction === 'record_awb' ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                Save AWB
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <section className="lg:sticky lg:top-6" data-testid="ops-order-timeline">
        <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-3">
          Timeline
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ol className="rounded-md border border-border bg-white divide-y divide-border">
            {events.map((ev) => (
              <li key={ev.id} className="px-4 py-3">
                <p className="text-sm font-extrabold text-foreground">
                  {getOrderStatusLabel(ev.status)}
                </p>
                {ev.note && (
                  <p className="text-sm text-muted-foreground mt-0.5">{ev.note}</p>
                )}
                <p className="text-[11px] font-medium text-muted-foreground mt-1 tabular-nums">
                  {formatWhen(ev.created_at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
      </div>

      <OpsWeighSheet
        open={weighOpen}
        onOpenChange={setWeighOpen}
        orderId={order.id}
        bookedWeight={order.booked_weight}
        isPending={action.isPending && pendingAction === 'weigh'}
        onConfirm={(payload) => runAction('weigh', payload)}
      />

      <OpsCollectPaymentSheet
        open={collectOpen}
        onOpenChange={(open) => {
          setCollectOpen(open);
          if (!open) setReceipt(null);
        }}
        orderNo={order.order_no}
        dueAmount={dueAmount}
        isPending={action.isPending && pendingAction === 'collect_payment'}
        receipt={receipt}
        onConfirm={(payload) => runAction('collect_payment', payload)}
      />

      <OpsDropoffOtpSheet
        open={dropoffOpen}
        onOpenChange={(open) => {
          setDropoffOpen(open);
          if (!open) setDropoffError(null);
        }}
        isPending={action.isPending && pendingAction === 'mark_received_dropoff'}
        error={dropoffError}
        onConfirm={({ otp }) => runAction('mark_received_dropoff', { otp })}
      />
    </OpsShell>
  );
}
