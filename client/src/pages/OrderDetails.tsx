/**
 * Customer-facing detail for an order (`BOM-xxxxxx`).
 *
 * Read top to bottom, one column, and it answers three questions in order:
 *
 *   1. Where is it?       The status in words, the route, a progress bar.
 *   2. What do I do now?  One panel, the only boxed thing on the page, holding
 *                         just what needs the customer's hand: pay, print
 *                         labels, read out a code, call the agent, find a
 *                         counter. Nothing to do, no panel.
 *   3. What happened?     Updates, then the booking as submitted.
 *
 * Everything else sits on the page with hairline dividers rather than in
 * cards: one radius (8px), one container, one reading path.
 *
 * Everything comes from `GET /api/orders/:orderNo`; this page derives nothing
 * about the state machine beyond which step of the progress bar to light. The
 * server sends the customer-facing status phrase and the actions the customer
 * may take, and the page renders exactly those.
 *
 * The `id`s `#handover-code`, `#labels`, `#pay` and `#cancel` are where BIA's
 * buttons land: the customer presses the real button here.
 */

import { useAppStore } from '@/lib/store';
import { useState } from 'react';
import { useRoute, useLocation, Link } from 'wouter';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Loader2,
  Phone,
  RefreshCw,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, isValid } from 'date-fns';
import { BottomNav } from '@/components/BottomNav';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiRequest } from '@/lib/queryClient';
import { payForOrder } from '@/lib/razorpay';
import { PaymentTestModeSwitch } from '@/components/PaymentTestModeSwitch';
import { DropoffBranches } from '@/components/DropoffBranches';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  formatDeclaredValue,
  formatDimensions,
  formatInr,
  hsCode,
  itemStr,
  paymentMethodLabel,
  paymentStatusLabel,
  type OrderDetailEvent,
} from '@/lib/orderDetail';
import {
  ORDER_HISTORY_KEY,
  orderDetailKey,
  useCustomerOrderDetail,
} from '@/hooks/useCustomerOrders';
import { useSupportContacts } from '@/hooks/useSupportContacts';
import { AskBiaTopButton } from '@/components/bia/AskBiaTopButton';
import {
  Group,
  HUB_STATUSES,
  IdCell,
  NAVY,
  ProgressBar,
  Row,
  progressFor,
} from '@/components/order/OrderParts';
import { ShipmentDocuments, useShipmentDocuments } from '@/components/ShipmentDocuments';
import { PdfDocButton, fetchPdfBase64 } from '@/components/PdfDocButton';
import { TrackingTimeline } from '@/components/TrackingTimeline';
import { getStatusLabel } from '@/lib/awbStatus';
import {
  getDocketValue,
  mapEvents,
  useAwbTracking,
  withKg,
} from '@/hooks/useAwbTracking';

// ─── Small helpers ──────────────────────────────────────────────────────────

/** "2026-08-04" or a full ISO stamp → "04 Aug 2026". Blank when unparseable. */
function niceDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseISO(value.length <= 10 ? `${value}T12:00:00Z` : value);
  return isValid(d) ? format(d, 'dd MMM yyyy') : '';
}

function niceDateTime(value: string): string {
  const d = parseISO(value);
  return isValid(d) ? format(d, "dd MMM yyyy, h:mm a") : value;
}

/** Weight the customer entered, in the unit they think in. */
function formatKg(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Number.isInteger(value) ? value : value.toFixed(2)} kg`;
}

/** Copy to clipboard; `copied` holds the value for two seconds after. */
function useCopy(): [string | null, (value: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied((c) => (c === value ? null : c)), 2000);
  };
  return [copied, copy];
}

// ─── Primitives ─────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-order">
      <main className="max-w-2xl mx-auto px-4 md:px-6 pt-3 pb-12 md:pt-6 md:pb-16">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}

function TopBar({
  onBack,
  onRefresh,
  isFetching,
}: {
  onBack: () => void;
  onRefresh?: () => void;
  isFetching?: boolean;
}) {
  return (
    <div className="flex items-center justify-between mb-4 md:mb-6">
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 inline-flex items-center gap-1.5 h-10 px-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg"
        data-testid="button-back"
      >
        <ArrowLeft className="w-4 h-4" />
        My shipments
      </button>
      <div className="-mr-2 flex items-center gap-1">
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isFetching}
            className="grid place-items-center w-10 h-10 text-muted-foreground hover:text-foreground transition-colors rounded-lg disabled:opacity-50"
            aria-label={isFetching ? 'Refreshing order' : 'Refresh order'}
            data-testid="button-refresh-order"
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </button>
        )}
        <AskBiaTopButton withLabel />
      </div>
    </div>
  );
}

/** A page section: heading on the page, hairline above, no box. */
function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="mt-8 pt-6 border-t border-[#E2E8F0] scroll-mt-24">
      <h2 className="text-base font-semibold text-foreground mb-4">{title}</h2>
      {children}
    </section>
  );
}

/** One line in the to-do panel: what, why, and the control to do it. */
function Task({
  title,
  hint,
  action,
  children,
  id,
  testId,
}: {
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  id?: string;
  testId?: string;
}) {
  return (
    <div id={id} className="px-4 py-4 scroll-mt-24" data-testid={testId}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {hint && <p className="mt-0.5 text-[13px] text-muted-foreground leading-snug">{hint}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** A warning line in the panel: icon, words, colour only as reinforcement. */
function Notice({
  tone,
  title,
  children,
  testId,
}: {
  tone: 'amber' | 'red';
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className={cn('px-4 py-3.5 flex gap-3', tone === 'amber' ? 'bg-amber-50' : 'bg-red-50')}
      role="status"
      data-testid={testId}
    >
      <AlertTriangle
        className={cn('w-4 h-4 shrink-0 mt-0.5', tone === 'amber' ? 'text-amber-700' : 'text-red-700')}
        aria-hidden
      />
      <div className="min-w-0 text-[13px] leading-snug">
        <p className={cn('font-semibold', tone === 'amber' ? 'text-amber-900' : 'text-red-900')}>
          {title}
        </p>
        <div className={cn('mt-0.5', tone === 'amber' ? 'text-amber-900/80' : 'text-red-900/80')}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Order log ──────────────────────────────────────────────────────────────

const ACTOR_LABELS: Record<OrderDetailEvent['actorKind'], string> = {
  agent: 'Pickup agent',
  ops: 'Bombino hub',
  you: 'You',
  system: 'Bombino',
};

/** The lifecycle log, newest first, same reading order as carrier scans. */
function UpdatesTimeline({ events }: { events: OrderDetailEvent[] }) {
  const ordered = [...events].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );

  return (
    <ol>
      {ordered.map((event, index) => {
        const isLatest = index === 0;
        const isLast = index === ordered.length - 1;
        const who = event.actorName
          ? `${ACTOR_LABELS[event.actorKind]}, ${event.actorName}`
          : ACTOR_LABELS[event.actorKind];

        return (
          <li
            key={event.id}
            className="relative flex gap-3.5 pb-5 last:pb-0"
            data-testid={`order-event-${event.id}`}
          >
            <div className="flex flex-col items-center pt-1.5">
              <span
                className={cn(
                  'h-2 w-2 rounded-full shrink-0',
                  isLatest ? 'bg-[#F2A123]' : 'bg-[#CBD5E1]'
                )}
              />
              {!isLast && <span className="mt-1.5 w-px flex-1 bg-[#E2E8F0]" />}
            </div>
            <div className="flex-1 min-w-0 -mt-0.5">
              <p className={cn('text-sm', isLatest ? 'font-semibold text-foreground' : 'text-foreground/85')}>
                {event.label}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {who}
                {event.amount != null && `, ${formatInr(event.amount)} collected`}
                {' · '}
                <span className="tabular-nums">{niceDateTime(event.at)}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Labels ─────────────────────────────────────────────────────────────────

/**
 * Whether this AWB has stored labels. 'no' covers an AWB ops typed in by hand
 * and a guest's order: neither has a docket response to print from.
 */
function useHasLabels(awb: string | null, enabled: boolean): 'yes' | 'loading' | 'no' {
  const { documents, isLoading } = useShipmentDocuments(awb ?? '', {
    enabled: enabled && !!awb,
  });
  if (!enabled || !awb) return 'no';
  if (documents.length > 0) return 'yes';
  return isLoading ? 'loading' : 'no';
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function OrderDetails() {
  const [, params] = useRoute('/order/:orderNo');
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { telHref } = useSupportContacts();
  const [copied, copy] = useCopy();
  const [showAllParcel, setShowAllParcel] = useState(false);
  const [showBookingLog, setShowBookingLog] = useState(false);

  const orderNo = params?.orderNo ? decodeURIComponent(params.orderNo) : '';
  // A guest can read this screen but not act on it: the regenerate and action
  // endpoints are account-only, and a guest's order has no stored labels.
  const { isLoggedIn } = useAppStore();

  // Polls every 20s while the order can still move, and stops at dispatched or
  // cancelled. This screen is where a customer waits out a pickup, so an agent
  // accepting the job has to land here without a reload.
  const { data, isLoading, isFetching, error } = useCustomerOrderDetail(orderNo);

  // Carrier scans, once the parcel has left us. Not asked for before then:
  // ITD has nothing to say about a parcel still in the customer's house, and
  // every call is a round trip to them.
  const trackedAwb =
    data?.order.awb_no && data.order.status === 'dispatched' ? data.order.awb_no : '';
  const { data: tracking } = useAwbTracking(trackedAwb, { enabled: !!trackedAwb });

  const stillWithUs =
    !!data && data.order.status !== 'dispatched' && data.order.status !== 'cancelled';
  const hasLabels = useHasLabels(data?.order.awb_no ?? null, isLoggedIn && stillWithUs);

  /**
   * The customer asks; ops decides.
   *
   * This does not cancel anything and must never say it did: the order stays
   * live, the agent still comes, and the parcel is only off once ops acts. See
   * the cancellation block in `server/orderLifecycle.ts`.
   */
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const requestCancelMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const reason = cancelReason.trim();
      const res = await apiRequest('POST', `/api/orders/${orderId}/actions`, {
        action: 'request_cancellation',
        ...(reason ? { payload: { reason } } : {}),
      });
      return res.json() as Promise<{ order: { status: string } }>;
    },
    onSuccess: () => {
      setCancelOpen(false);
      setCancelReason('');
      toast({
        title: 'Cancellation requested',
        description: `We have passed ${orderNo} to our team. Your pickup stands until they confirm.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
      // The list is keyed separately (it merges orders with ITD shipments), so
      // it does not fall out of the prefix invalidation above.
      void queryClient.invalidateQueries({ queryKey: ORDER_HISTORY_KEY });
    },
    onError: (err: unknown) => {
      toast({
        title: 'Could not send that request',
        description: err instanceof Error ? err.message : 'Your request could not be sent.',
        variant: 'destructive',
      });
    },
  });

  /**
   * A fresh handover code, when the one on screen has been locked by wrong
   * guesses or never wrote at all.
   *
   * The server picks which code the caller is entitled to from the order's
   * state; this sends no kind, so a customer can never ask for the agent's.
   */
  const regenerateHandover = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await apiRequest('POST', `/api/orders/${orderId}/handover-code`);
      return res.json() as Promise<{ handover: { kind: string; code: string } }>;
    },
    onSuccess: () => {
      toast({ title: 'New code ready', description: 'Read out the code shown on this screen.' });
      void queryClient.invalidateQueries({ queryKey: orderDetailKey(orderNo) });
    },
    onError: (err: unknown) => {
      toast({
        title: 'Could not get a new code',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  /**
   * The second door into Razorpay. The first is booking; this one is for the
   * customer who dismissed that modal, or whose card failed, and came back.
   * Same server endpoints: a fresh gateway order against the same order id.
   */
  const [paying, setPaying] = useState(false);

  const handlePayNow = async (orderId: string): Promise<void> => {
    setPaying(true);
    const outcome = await payForOrder(orderId);
    setPaying(false);

    if (outcome.status === 'dismissed') return;

    if (outcome.status === 'paid') {
      toast({ title: 'Payment successful', description: 'This order is now paid.' });
    } else if (outcome.status === 'pending') {
      toast({
        title: 'Confirming payment',
        description: `${outcome.message} Please do not pay again.`,
      });
    } else {
      toast({ title: 'Payment failed', description: outcome.message, variant: 'destructive' });
    }

    // Even a failure refetches: the webhook may have settled the order while
    // the browser was deciding it had not.
    void queryClient.invalidateQueries({ queryKey: ['/api/orders', orderNo] });
    void queryClient.invalidateQueries({ queryKey: ORDER_HISTORY_KEY });
  };

  const handleBack = () => {
    if (window.history.length > 1) window.history.back();
    else setLocation('/orders');
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['/api/orders', orderNo] });
  };

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <PageShell>
        <TopBar onBack={handleBack} />
        <div className="animate-pulse" aria-busy="true">
          <div className="h-3 w-40 bg-muted rounded" />
          <div className="h-7 w-64 bg-muted rounded mt-3" />
          <div className="h-4 w-52 bg-muted rounded mt-3" />
          <div className="h-1 w-full bg-muted rounded-full mt-6" />
          <div className="h-40 w-full bg-white border border-[#E2E8F0] rounded-lg mt-6" />
        </div>
      </PageShell>
    );
  }

  // ─── Error / Not found ───────────────────────────────────────────────────
  if (error || !data) {
    return (
      <PageShell>
        <TopBar
          onBack={handleBack}
          onRefresh={orderNo ? refresh : undefined}
          isFetching={isFetching}
        />
        <section className="py-12 text-center">
          <AlertTriangle className="w-6 h-6 text-red-600 mx-auto" aria-hidden />
          <h1 className="text-lg font-semibold mt-3">We could not open this order</h1>
          {orderNo && <p className="text-sm text-muted-foreground mt-1 tabular-nums">{orderNo}</p>}
          <p className="text-sm text-muted-foreground mt-3 max-w-xs mx-auto leading-relaxed">
            {error instanceof Error
              ? error.message
              : 'It may belong to another account, or the number may be mistyped.'}
          </p>
          <Button
            variant="outline"
            className="mt-6 rounded-lg h-10"
            onClick={() => setLocation('/orders')}
          >
            Back to my shipments
          </Button>
        </section>
      </PageShell>
    );
  }

  const {
    order,
    customerStatus,
    agent,
    events,
    payments,
    availableActions,
    cancellationRequest,
    handover,
    awbNote,
  } = data;
  const items = order.items;
  const consignee = order.consignee;
  const origin = order.origin_address;
  const isPickup = order.pickup_request === 1;
  const isCancelled = order.status === 'cancelled';
  const isDispatched = order.status === 'dispatched';
  // Still in the customer's hands: before an agent collects it or it is handed
  // in at a counter. Labels, the code and "where to take it" only matter here.
  const beforeCollection =
    stillWithUs && !HUB_STATUSES.has(order.status) && order.status !== 'picked_up';
  const canRequestCancel = availableActions.some((a) => a.action === 'request_cancellation');
  const cancelPending = cancellationRequest?.pending ?? false;
  const cancelDeclined = cancellationRequest?.state === 'rejected';
  const isCsbv = itemStr(items, 'is_csbv_shipment') === 'true';
  // Pay-now orders still owed money. `partially_paid` is a reprice at the hub
  // and settles there, not here.
  const payDue =
    order.payment_method === 'pay_now' && order.payment_status === 'pending' && !isCancelled;
  const amountLabel = formatInr(order.final_amount ?? order.quoted_amount);

  const originLine = [origin?.city, origin?.state].filter(Boolean).join(', ');
  const destLine = [consignee?.city, consignee?.country_name].filter(Boolean).join(', ');

  const originAddress = [
    origin?.address_line_1,
    origin?.address_line_2,
    [origin?.city, origin?.state].filter(Boolean).join(', '),
    origin?.pincode,
  ]
    .filter(Boolean)
    .join('\n');

  const consigneeAddress = [
    consignee?.address_line_1,
    [consignee?.city, consignee?.state].filter(Boolean).join(', '),
    [consignee?.pincode, consignee?.country_name].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .join('\n');

  // Same reading of ITD's answer as /shipment/:awb.
  const trackingResult = tracking && !tracking.fromCache ? tracking.results[0] : undefined;
  const docketEvents =
    trackingResult && !trackingResult.errors ? trackingResult.docket_events ?? [] : [];
  const carrierEvents = mapEvents(docketEvents);
  const carrierInfo = trackingResult?.docket_info ?? [];
  const lastScan = docketEvents.length > 0 ? docketEvents[docketEvents.length - 1] : undefined;
  const lastScanLabel = lastScan?.event_state ? getStatusLabel(lastScan.event_state) : '';
  const carrierStatus = getDocketValue(carrierInfo, 'Status') || lastScanLabel;
  const chargeableWeight = withKg(
    trackingResult?.chargeable_weight || getDocketValue(carrierInfo, 'Chargeable Weight')
  );
  const delivered = lastScanLabel === 'Delivered';

  const progress = progressFor(order.status, isPickup, delivered);
  // Once shipped, the carrier's word is fresher than ours.
  const headline = isDispatched && carrierStatus ? carrierStatus : customerStatus;

  // ─── To do ───────────────────────────────────────────────────────────────
  const showAwbNote = !order.awb_no && !!awbNote;
  const showLabels = isLoggedIn && !!order.awb_no && beforeCollection && hasLabels !== 'no';
  // Booked without an ITD login (a guest, or an account with no ITD password):
  // no AWB until the hub dockets it, so our own box label, the order number
  // and a QR. The server decides who qualifies (server/routes/parcel.ts).
  const showBoxLabel = !!data.boxLabel && beforeCollection;
  const showCounters = !isPickup && beforeCollection;
  const showCode = !!handover && stillWithUs;
  const showAgent = isPickup && beforeCollection;

  const hasTodo =
    showAwbNote ||
    cancelPending ||
    cancelDeclined ||
    payDue ||
    showLabels ||
    showBoxLabel ||
    showCounters ||
    showCode ||
    showAgent;

  const todoTitle = !beforeCollection
    ? 'Needs your attention'
    : isPickup
      ? 'Before your pickup'
      : 'Before you drop it off';

  const todo = hasTodo && (
    <section className="mt-6" aria-labelledby="todo-title" data-testid="card-next-step">
      <h2 id="todo-title" className="text-base font-semibold text-foreground mb-3">
        {todoTitle}
      </h2>
      <div className="rounded-lg border border-[#E2E8F0] bg-white overflow-hidden divide-y divide-[#E2E8F0]">
        {/* Only when the AWB is waiting on the customer (shared/docketError.ts
            returns a note for nothing else). */}
        {showAwbNote && (
          <Notice tone="amber" title="One thing needed from you" testId="order-awb-note">
            {awbNote}
          </Notice>
        )}

        {/* A request with the team. Not styled as a success: nothing has been
            cancelled yet, and the pickup stands. */}
        {cancelPending && (
          <Notice tone="amber" title="Cancellation requested" testId="banner-cancellation-pending">
            Our team is reviewing your request
            {cancellationRequest?.requestedAt
              ? ` from ${niceDate(cancellationRequest.requestedAt)}`
              : ''}
            . Until they confirm, this order is still going ahead, so keep your parcel ready.
            {cancellationRequest?.reason && (
              <span className="block mt-1 italic">“{cancellationRequest.reason}”</span>
            )}
          </Notice>
        )}

        {/* Declined. The customer may ask again: the request link at the
            bottom reappears, because a rejected request reads as closed. */}
        {cancelDeclined && cancellationRequest && (
          <Notice tone="red" title="Cancellation declined" testId="banner-cancellation-declined">
            {cancellationRequest.decisionNote ??
              'Our team could not cancel this order. It is still going ahead as booked.'}{' '}
            <a href={telHref} className="font-semibold underline underline-offset-2">
              Call us
            </a>
          </Notice>
        )}

        {payDue && (
          <Task
            id="pay"
            title="Payment due"
            hint={`${amountLabel ?? 'Amount'} to pay online`}
            action={
              <Button
                className="h-10 px-5 rounded-lg"
                disabled={paying}
                onClick={() => void handlePayNow(order.id)}
                data-testid="button-pay-now"
              >
                {paying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Pay now'}
              </Button>
            }
          >
            {/* TEMPORARY: only renders when the server has PAYMENTS_TEST_MODE. */}
            <PaymentTestModeSwitch />
          </Task>
        )}

        {showBoxLabel && (
          <Task
            id="labels"
            title="Print your box label"
            hint="Stick it on the box. The QR lets our agent and hub find your order."
            testId="card-box-label"
          >
            <PdfDocButton
              text="Box label"
              title="Box label"
              fileName={`${order.order_no}-box-label.pdf`}
              primary
              testId="button-box-label"
              fetchBase64={() =>
                fetchPdfBase64(
                  `/api/orders/${encodeURIComponent(order.order_no)}/box-label`,
                  'boxLabel',
                  'Box label',
                  toast
                )
              }
            />
          </Task>
        )}

        {/* The box label has to be on the parcel before the agent arrives or
            it reaches the counter. */}
        {showLabels && (
          <Task
            id="labels"
            title="Print your labels"
            hint="Stick the box label on the parcel. Keep the AWB label with it."
            testId="card-shipment-labels"
          >
            {hasLabels === 'yes' ? (
              <div className="flex flex-wrap items-center gap-2">
                <ShipmentDocuments awb={order.awb_no as string} />
              </div>
            ) : (
              <p className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Preparing your labels
              </p>
            )}
          </Task>
        )}

        {showAgent && (
          <Task
            title={agent ? agent.name ?? 'Your pickup agent' : 'Finding a pickup agent'}
            hint={
              agent
                ? `Collecting your parcel${order.pickup_date ? ` on ${niceDate(order.pickup_date)}` : ''}`
                : 'We will notify you as soon as one accepts.'
            }
            action={
              agent?.phone ? (
                <a
                  href={`tel:${agent.phone}`}
                  className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-semibold rounded-lg border border-[#E2E8F0] text-foreground hover:bg-muted transition-colors"
                  data-testid="button-call-agent"
                >
                  <Phone className="w-4 h-4" />
                  Call
                </a>
              ) : undefined
            }
          />
        )}

        {/* Read out at the door or the counter. Mono and spaced so it can be
            read aloud without losing a digit. */}
        {showCode && handover && (
          <Task
            id="handover-code"
            testId="card-handover-code"
            title={handover.kind === 'pickup' ? 'Pickup code' : 'Drop-off code'}
            hint={
              handover.locked
                ? 'Entered wrongly too many times. Get a new code before handing over.'
                : handover.code
                  ? handover.kind === 'pickup'
                    ? 'Read it to the agent when they arrive. Share it with no one else.'
                    : 'Read it at the counter when you hand the parcel in.'
                  : isLoggedIn
                    ? 'No code yet.'
                    : 'No code yet. Call us and we will issue one.'
            }
          >
            <div className="flex items-center justify-between gap-3">
              <p
                className={cn(
                  'font-mono text-[28px] font-bold leading-none tracking-[0.2em] tabular-nums',
                  handover.locked && 'text-muted-foreground line-through'
                )}
                style={handover.locked ? undefined : { color: NAVY }}
                data-testid="text-handover-code"
              >
                {handover.code ?? '----'}
              </p>
              {isLoggedIn && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-10 px-3 text-sm font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  disabled={regenerateHandover.isPending}
                  onClick={() => regenerateHandover.mutate(order.id)}
                  data-testid="button-regenerate-handover"
                >
                  {regenerateHandover.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  {handover.code ? 'New code' : 'Get a code'}
                </button>
              )}
            </div>
          </Task>
        )}

        {/* The booking is made and the parcel is still at home: this is the
            moment the counter's address actually gets used. */}
        {showCounters && (
          <Task title="Where to drop it off">
            <DropoffBranches
              pincode={origin?.pincode}
              city={origin?.city}
              state={origin?.state}
              title="Nearest counters"
              className="mt-0 border-0 bg-transparent p-0"
            />
          </Task>
        )}
      </div>
    </section>
  );

  // ─── Updates ─────────────────────────────────────────────────────────────
  const hasCarrier = carrierEvents.length > 0;
  const updates = (
    <Section title="Updates">
      {hasCarrier ? (
        <>
          <TrackingTimeline events={carrierEvents} currentStatus={carrierStatus} />
          {events.length > 0 && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setShowBookingLog((v) => !v)}
                className="inline-flex items-center gap-1 h-10 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                aria-expanded={showBookingLog}
              >
                Before it shipped ({events.length})
                <ChevronDown
                  className={cn('w-4 h-4 transition-transform duration-200', showBookingLog && 'rotate-180')}
                />
              </button>
              {showBookingLog && (
                <div className="mt-3">
                  <UpdatesTimeline events={events} />
                </div>
              )}
            </div>
          )}
        </>
      ) : events.length > 0 ? (
        <UpdatesTimeline events={events} />
      ) : (
        <p className="text-sm text-muted-foreground">No updates yet.</p>
      )}
      {stillWithUs && (
        <p className="mt-5 text-[13px] text-muted-foreground leading-relaxed">
          {order.awb_no
            ? 'Carrier scans start once we have your parcel.'
            : 'Carrier tracking starts once your parcel reaches our hub and an airway bill is issued.'}
        </p>
      )}
    </Section>
  );

  // ─── Details: the booking as submitted ───────────────────────────────────
  const details = (
    <Section title="Details">
      <div className="grid gap-x-10 gap-y-7 md:grid-cols-2">
        <Group title="Payment">
          <Row label="Amount" value={amountLabel} />
          {order.final_amount != null &&
            order.quoted_amount != null &&
            order.final_amount !== order.quoted_amount && (
              <Row label="Quoted" value={formatInr(order.quoted_amount)} />
            )}
          <Row label="Method" value={paymentMethodLabel(order.payment_method)} />
          <Row
            label="Status"
            value={order.is_cod ? 'Recipient pays on delivery' : paymentStatusLabel(order.payment_status)}
          />
          {payments.map((p) => (
            <Row
              key={p.id}
              label={niceDate(p.collectedAt) || 'Paid'}
              value={[
                formatInr(p.amount) ?? `${p.currency} ${p.amount}`,
                paymentMethodLabel(p.method),
                p.collectedByName ? `by ${p.collectedByName}` : null,
                p.reference ? `Ref ${p.reference}` : null,
              ]
                .filter(Boolean)
                .join('\n')}
            />
          ))}
        </Group>

        <Group title="Parcel">
          <Row label="Contents" value={itemStr(items, 'shipment_content')} />
          <Row label="Pieces" value={itemStr(items, 'pcs')} />
          <Row label="Weight" value={formatKg(order.booked_weight)} />
          {order.actual_weight != null && (
            <Row label="Weighed at hub" value={formatKg(order.actual_weight)} />
          )}
          <Row label="Chargeable" value={chargeableWeight || null} />
          <Row label="Declared value" value={formatDeclaredValue(items)} />
          {showAllParcel && (
            <>
              <Row label="Packaging" value={order.packaging_required ? 'We pack it' : 'Already packed'} />
              <Row label="Dimensions" value={formatDimensions(items)} />
              <Row label="Product type" value={itemStr(items, 'product_code')} />
              <Row label="Service" value={itemStr(items, 'api_service_code')} />
              {isCsbv && (
                <>
                  <Row label="HS code" value={hsCode(items)} />
                  <Row label="Dispatch type" value={itemStr(items, 'dispatch_type')} />
                  <Row label="E-commerce" value={itemStr(items, 'is_ecommerce') === 'yes' ? 'Yes' : 'No'} />
                  <Row label="Under scheme" value={itemStr(items, 'is_scheme') === 'yes' ? 'Yes' : 'No'} />
                  <Row
                    label="Tax basis"
                    value={itemStr(items, 'is_bond_ut') === 'bond_ut' ? 'Bond / LUT' : 'IGST'}
                  />
                  <Row label="LUT number" value={itemStr(items, 'lut_number')} />
                </>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setShowAllParcel((v) => !v)}
            className="mt-1 inline-flex items-center gap-1 h-10 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={showAllParcel}
            data-testid="button-toggle-parcel-details"
          >
            {showAllParcel ? 'Show less' : 'Show all'}
            <ChevronDown
              className={cn('w-4 h-4 transition-transform duration-200', showAllParcel && 'rotate-180')}
            />
          </button>
        </Group>

        <Group title="Recipient">
          <Row label="Name" value={consignee?.name} />
          <Row label="Company" value={consignee?.company} />
          <Row label="Phone" value={consignee?.phone} />
          <Row label="Email" value={consignee?.email} />
          <Row label="Address" value={consigneeAddress} />
        </Group>

        <Group title={isPickup ? 'Pickup from' : 'Sender'}>
          <Row label="Name" value={origin?.full_name} />
          <Row label="Company" value={origin?.company} />
          <Row label="Phone" value={origin?.phone} />
          {isPickup && <Row label="Pickup date" value={niceDate(order.pickup_date)} />}
          <Row label="Address" value={originAddress} />
        </Group>
      </div>
    </Section>
  );

  return (
    <PageShell>
      <TopBar onBack={handleBack} onRefresh={refresh} isFetching={isFetching} />

      {/* ─── Where is it ──────────────────────────────────────────────────── */}
      <header>
        {/* Status as words, the biggest thing on the page. */}
        <h1
          className="text-[26px] md:text-[30px] font-bold tracking-tight leading-tight"
          style={{ color: isCancelled ? undefined : NAVY }}
          data-testid="text-order-status"
        >
          {headline}
        </h1>

        <p className="mt-1.5 text-sm text-muted-foreground">
          {originLine && destLine ? (
            <>
              <span className="text-foreground/85">{originLine}</span>
              <ArrowRight className="inline w-3.5 h-3.5 mx-1.5 -mt-0.5" aria-label="to" />
              <span className="text-foreground/85">{destLine}</span>
              <span className="mx-1.5">·</span>
            </>
          ) : null}
          Booked {niceDate(order.created_at)}
        </p>

        {/* The two numbers people ask for. The order number is ours; the
            airway bill is what the agent, the counter, customs and the
            recipient know the parcel by. Side by side, same weight, each one
            tap to copy, so neither reads as trivia under the other. */}
        <div className="mt-4 grid grid-cols-2 rounded-lg border border-[#E2E8F0] bg-white divide-x divide-[#E2E8F0] overflow-hidden">
          <IdCell
            label="Order number"
            value={order.order_no}
            copied={copied === order.order_no}
            onCopy={copy}
            valueTestId="text-order-no"
            testId="button-copy-order-no"
          />
          {order.awb_no ? (
            <IdCell
              label="Airway bill (AWB)"
              value={order.awb_no}
              mono
              copied={copied === order.awb_no}
              onCopy={copy}
              valueTestId="text-awb-no"
              testId="button-copy-awb"
            />
          ) : (
            <div className="px-4 py-3 min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.09em] uppercase text-muted-foreground">
                Airway bill (AWB)
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Not issued yet</p>
            </div>
          )}
        </div>

        {isDispatched && order.awb_no && (
          <Link
            href={`/shipment/${encodeURIComponent(order.awb_no)}`}
            className="mt-3 flex items-center justify-center gap-1.5 h-11 rounded-lg text-sm font-semibold text-white transition-colors hover:bg-[#2F4468]"
            style={{ backgroundColor: NAVY }}
            data-testid="link-track-awb"
          >
            Live tracking
            <ArrowRight className="w-4 h-4" aria-hidden />
          </Link>
        )}

        <div className="mt-5">
          {isCancelled ? (
            <p className="text-sm text-red-800">This order was cancelled.</p>
          ) : (
            <ProgressBar steps={progress.steps} current={progress.current} />
          )}
        </div>

        {data.warning && (
          <p className="mt-4 text-[13px] text-amber-900 leading-snug">{data.warning}</p>
        )}
      </header>

      {/* ─── What do I do now ─────────────────────────────────────────────── */}
      {todo}

      {/* After the parcel has gone the labels stop being a task, but copies
          and the invoice are still worth having. */}
      {isLoggedIn && order.awb_no && isDispatched && <DocumentsSection awb={order.awb_no} />}

      {/* ─── What happened ────────────────────────────────────────────────── */}
      {updates}
      {details}

      {/* Quiet on purpose: a way out, not a call to action. */}
      <div id="cancel" className="mt-10 mb-16 md:mb-0 scroll-mt-24">
        {canRequestCancel && (
          <div className="pt-6 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="inline-flex items-center h-10 -ml-2 px-2 rounded-lg text-sm font-semibold text-red-700 hover:bg-red-50 transition-colors"
              data-testid="button-request-cancellation"
            >
              Request cancellation
            </button>
            <p className="text-[13px] text-muted-foreground">
              Possible until we collect your parcel. Our team confirms every cancellation.
            </p>
          </div>
        )}
        {cancelPending && (
          <Link
            href="/orders?tab=cancellations"
            className="inline-flex items-center gap-1 h-10 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            See your cancellation requests
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Request cancellation?</AlertDialogTitle>
            <AlertDialogDescription>
              This sends {orderNo} to our team to review. It is not cancelled yet: your
              pickup stands until they confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="cancel-reason" className="text-xs text-muted-foreground">
              Reason (optional)
            </Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value.slice(0, 300))}
              placeholder="Tell us why, so the team can act on it faster"
              className="min-h-20 resize-none"
              data-testid="input-cancellation-reason"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={requestCancelMutation.isPending}>
              Keep my order
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={requestCancelMutation.isPending}
              onClick={() => requestCancelMutation.mutate(order.id)}
              data-testid="button-confirm-cancellation-request"
            >
              {requestCancelMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending
                </>
              ) : (
                'Send request'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

/** Labels and invoice once the parcel has gone. Nothing at all when none. */
function DocumentsSection({ awb }: { awb: string }) {
  const { documents } = useShipmentDocuments(awb);
  if (documents.length === 0) return null;
  return (
    <Section title="Documents">
      <div className="flex flex-wrap items-center gap-2">
        <ShipmentDocuments awb={awb} />
      </div>
    </Section>
  );
}
