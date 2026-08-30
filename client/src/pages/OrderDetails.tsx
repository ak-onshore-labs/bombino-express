/**
 * Customer-facing detail for a pre-docket order (`BOM-xxxxxx`).
 *
 * The counterpart to ShipmentDetails, which needs an AWB and therefore only
 * exists once ops has generated a docket. Between booking and dispatch there
 * was previously nothing to open — the list toasted "Not yet trackable" — even
 * though the order carries everything the customer entered plus a full
 * lifecycle log.
 *
 * Two things it shows that ShipmentDetails cannot: the booking as submitted,
 * and the pickup agent's progress. Both come from `GET /api/orders/:orderNo`;
 * this page derives nothing about the state machine itself — the server sends
 * the customer-facing status phrase and the list of actions the customer may
 * take, and the page renders exactly those.
 */

import { useState } from 'react';
import { useRoute, useLocation, Link } from 'wouter';
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  Truck,
  User,
  Wallet,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, isValid } from 'date-fns';
import { BottomNav } from '@/components/BottomNav';
import { StatusBadge } from '@/components/StatusBadge';
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
import { getOrderStatusTone } from '@/lib/orderStatus';
import { apiRequest } from '@/lib/queryClient';
import { payForOrder } from '@/lib/razorpay';
import { PaymentTestModeSwitch } from '@/components/PaymentTestModeSwitch';
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

const BRAND_NAVY = 'lab(34.0831 -9.57756 -27.7093)';

// ─── Small helpers ──────────────────────────────────────────────────────────

/** "2026-08-04" or a full ISO stamp → "04 Aug 2026". Blank when unparseable. */
function niceDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseISO(value.length <= 10 ? `${value}T12:00:00Z` : value);
  return isValid(d) ? format(d, 'dd MMM yyyy') : '';
}

function niceDateTime(value: string): string {
  const d = parseISO(value);
  return isValid(d) ? format(d, "dd MMM yyyy 'at' h:mm a") : value;
}

/** Weight the customer entered, in the unit they think in. */
function formatKg(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Number.isInteger(value) ? value : value.toFixed(2)} kg`;
}

// ─── Layout primitives ──────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background pb-nav" data-testid="screen-order">
      <main className="max-w-3xl mx-auto px-5 md:px-0 pt-4 pb-10 md:pt-6 md:pb-14">
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
    <div className="flex items-center justify-between mb-7 md:mb-10">
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg"
        data-testid="button-back"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          className="-mr-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg disabled:opacity-50"
          aria-label="Refresh order"
          data-testid="button-refresh-order"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
          {isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="pt-6 mt-6 border-t border-border first:mt-0 first:pt-0 first:border-t-0">
      <div className="flex items-center justify-between gap-3 mb-3.5">
        <h2 className="inline-flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
          <Icon className="w-3.5 h-3.5 text-[#F2A123]" />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A label/value pair. Renders nothing at all when the value is empty — an
 * order booked before a field existed should leave no gap, not show a dash for
 * every optional thing the flow has ever collected.
 */
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5">{children}</dl>;
}

// ─── Agent updates ──────────────────────────────────────────────────────────

const ACTOR_LABELS: Record<OrderDetailEvent['actorKind'], string> = {
  agent: 'Pickup agent',
  ops: 'Bombino hub',
  you: 'You',
  system: 'Bombino',
};

/**
 * The lifecycle log, newest first — the same reading order as the tracking
 * timeline on a dispatched shipment, so the two screens do not disagree about
 * which end of the list is "now".
 */
function UpdatesTimeline({ events }: { events: OrderDetailEvent[] }) {
  const ordered = [...events].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );

  return (
    <div className="relative">
      {ordered.map((event, index) => {
        const isLatest = index === 0;
        const isLast = index === ordered.length - 1;
        const who = event.actorName
          ? `${ACTOR_LABELS[event.actorKind]} · ${event.actorName}`
          : ACTOR_LABELS[event.actorKind];

        return (
          <div
            key={event.id}
            className="relative flex gap-4 pb-5 last:pb-0"
            data-testid={`order-event-${event.id}`}
          >
            <div className="flex flex-col items-center pt-1">
              <div
                className={cn(
                  'h-3 w-3 rounded-full border-2 shrink-0',
                  isLatest
                    ? 'border-[#F2A123] bg-[#F2A123]'
                    : 'border-muted-foreground/40 bg-muted'
                )}
              />
              {!isLast && <div className="mt-1.5 w-0.5 flex-1 bg-border" />}
            </div>

            <div className="flex-1 min-w-0 -mt-0.5">
              <p
                className={cn(
                  'text-sm font-semibold',
                  isLatest ? 'text-foreground' : 'text-foreground/80'
                )}
              >
                {event.label}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {who}
                {event.amount != null && ` · ${formatInr(event.amount)} collected`}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                {niceDateTime(event.at)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function OrderDetails() {
  const [, params] = useRoute('/order/:orderNo');
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const orderNo = params?.orderNo ? decodeURIComponent(params.orderNo) : '';

  // Polls every 20s while the order can still move, and stops at dispatched or
  // cancelled. This screen is where a customer waits out a pickup, so an agent
  // accepting the job has to land here without a reload.
  const { data, isLoading, isFetching, error } = useCustomerOrderDetail(orderNo);

  /**
   * The customer asks; ops decides.
   *
   * This does not cancel anything and must never say it did — the order stays
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
        description:
          err instanceof Error ? err.message : 'Your request could not be sent.',
        variant: 'destructive',
      });
    },
  });

  /**
   * A fresh handover code, when the one on screen has been locked by wrong
   * guesses or never wrote at all.
   *
   * The server picks which code the caller is entitled to from the order's
   * state — this sends no kind, so a customer can never ask for the agent's.
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
   * Same server endpoints — a fresh gateway order against the same order id.
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

  const copyOrderNo = () => {
    void navigator.clipboard.writeText(orderNo);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['/api/orders', orderNo] });
  };

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <PageShell>
        <TopBar onBack={handleBack} />
        <div className="space-y-6 animate-pulse">
          <div>
            <div className="h-3 w-16 bg-muted rounded" />
            <div className="h-8 w-56 bg-muted rounded mt-2" />
          </div>
          <div className="h-4 w-64 bg-muted rounded" />
          <div className="pt-4 border-t border-border">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto mt-6" />
          </div>
        </div>
      </PageShell>
    );
  }

  // ─── Error / Not found ───────────────────────────────────────────────────
  if (error || !data) {
    return (
      <PageShell>
        <TopBar onBack={handleBack} onRefresh={orderNo ? refresh : undefined} isFetching={isFetching} />
        <section className="py-10 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-red-50 text-red-500 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold mt-4">Order not found</h2>
          {orderNo && (
            <p className="text-sm text-muted-foreground mt-1 tabular-nums">{orderNo}</p>
          )}
          <p className="text-xs text-muted-foreground mt-3 max-w-xs mx-auto leading-relaxed">
            {error instanceof Error
              ? error.message
              : 'This order could not be loaded. It may belong to another account.'}
          </p>
          <Button
            variant="outline"
            className="mt-5 rounded-lg"
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
  } = data;
  const items = order.items;
  const consignee = order.consignee;
  const origin = order.origin_address;
  const isPickup = order.pickup_request === 1;
  const canRequestCancel = availableActions.some((a) => a.action === 'request_cancellation');
  const cancelPending = cancellationRequest?.pending ?? false;

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
    [consignee?.pincode, consignee?.country_name].filter(Boolean).join(' · '),
  ]
    .filter(Boolean)
    .join('\n');

  const isCsbv = itemStr(items, 'is_csbv_shipment') === 'true';

  return (
    <PageShell>
      <TopBar onBack={handleBack} onRefresh={refresh} isFetching={isFetching} />

      {/* ─── Hero ─────────────────────────────────────────────────────── */}
      <header>
        <p className="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
          Order
        </p>
        {/* The order number is the identity of this page and must never be
            elided. Status phrases run long ("Arrived at Bombino hub"), so the
            badge wraps to its own line rather than squeezing the number. */}
        <div className="flex flex-wrap items-center gap-y-2 mt-1.5">
          <h1
            className="text-[26px] font-bold tracking-tight tabular-nums"
            style={{ color: BRAND_NAVY }}
            data-testid="text-order-no"
          >
            {order.order_no}
          </h1>
          <button
            type="button"
            onClick={copyOrderNo}
            className="ml-1.5 mr-3 p-2 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors shrink-0"
            aria-label={`Copy order number ${order.order_no}`}
          >
            {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
          </button>
          <StatusBadge
            status={customerStatus}
            tone={getOrderStatusTone(order.status)}
            className="shrink-0"
          />
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          Booked {niceDate(order.created_at)}
          {originLine && destLine && (
            <>
              {' · '}
              <span className="text-foreground/80">
                {originLine} → {destLine}
              </span>
            </>
          )}
        </p>

        {/* ─── Handover code ────────────────────────────────────────────
            High on the page, because this is what the customer opens the app
            to find while somebody stands in front of them waiting. Set in the
            same mono the agent's screen uses, spaced so it can be read out
            loud without losing a digit. */}
        {handover && (
          <div
            className="mt-4 rounded-xl border-2 p-4"
            style={{ borderColor: BRAND_NAVY }}
            data-testid="card-handover-code"
          >
            <p
              className="text-[11px] font-bold tracking-[0.12em] uppercase"
              style={{ color: BRAND_NAVY }}
            >
              {handover.kind === 'pickup' ? 'Pickup code' : 'Drop-off code'}
            </p>

            <p
              className="font-mono text-[34px] font-bold leading-none tracking-[0.16em] tabular-nums mt-2.5"
              style={{ color: BRAND_NAVY }}
              data-testid="text-handover-code"
            >
              {handover.code ?? '————'}
            </p>

            <p className="mt-2.5 text-xs text-muted-foreground leading-relaxed">
              {handover.locked
                ? 'This code has been entered wrongly too many times. Generate a new one before handing the parcel over.'
                : handover.code
                  ? handover.kind === 'pickup'
                    ? 'Read this out to the agent when they arrive. Do not share it with anyone else — it is what proves the parcel went to us.'
                    : 'Read this out at the Bombino hub counter when you drop your parcel off.'
                  : 'No code has been generated yet. Tap below to get one.'}
            </p>

            <Button
              variant="outline"
              className="mt-3 w-full h-10 rounded-lg"
              disabled={regenerateHandover.isPending}
              onClick={() => regenerateHandover.mutate(order.id)}
              data-testid="button-regenerate-handover"
            >
              {regenerateHandover.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Getting a new code
                </>
              ) : handover.code ? (
                'Get a new code'
              ) : (
                'Generate code'
              )}
            </Button>
          </div>
        )}

        {/* Not yet a docket. Said once, here, rather than as a toast the
            customer has to dismiss to see anything at all. */}
        {!order.awb_no && (
          <p className="mt-3 text-xs text-muted-foreground leading-relaxed bg-muted/50 border border-border rounded-lg px-3 py-2.5">
            Live carrier tracking starts once your parcel reaches the Bombino hub
            and an AWB is issued. Until then, the updates below are the full
            picture.
          </p>
        )}

        {/* The handover. An AWB means this record has stopped being the live
            one — the carrier scans live at /shipment/:awb, and this screen
            keeps only the booking history. Previously the number appeared as
            one more read-only field two thirds of the way down the page, with
            nothing to say it was now the thing to follow. */}
        {order.awb_no && (
          <Link
            href={`/shipment/${encodeURIComponent(order.awb_no)}`}
            className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 transition-colors hover:bg-green-100"
            data-testid="link-track-awb"
          >
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-green-900">
                Shipped — live tracking is open
              </span>
              <span className="block text-[11px] text-green-800/80 mt-0.5">
                AWB <span className="font-mono font-semibold">{order.awb_no}</span>
              </span>
            </span>
            <ArrowRight className="w-4 h-4 text-green-800 shrink-0" aria-hidden />
          </Link>
        )}

        {data.warning && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            {data.warning}
          </p>
        )}
      </header>

      <div className="mt-8">
        {/* ─── Agent + updates (pickup orders only) ────────────────────── */}
        {isPickup && (
          <Section icon={Truck} title="Pickup updates">
            {agent ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white p-3.5 mb-5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-[#F2A123]/15 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-[#F2A123]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {agent.name ?? 'Pickup agent assigned'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Your pickup agent
                    </p>
                  </div>
                </div>
                {agent.phone && (
                  <a
                    href={`tel:${agent.phone}`}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg text-white shrink-0"
                    style={{ backgroundColor: BRAND_NAVY }}
                    data-testid="button-call-agent"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Call
                  </a>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-5">
                No agent has accepted this pickup yet. You will be notified as
                soon as one does.
              </p>
            )}

            {events.length > 0 ? (
              <UpdatesTimeline events={events} />
            ) : (
              <p className="text-sm text-muted-foreground">No updates yet.</p>
            )}
          </Section>
        )}

        {/* Drop-off orders have no agent, but still have a history worth
            showing — the hub receipt lands here. */}
        {!isPickup && events.length > 0 && (
          <Section icon={Truck} title="Order updates">
            <UpdatesTimeline events={events} />
          </Section>
        )}

        {/* ─── Collection ──────────────────────────────────────────────── */}
        <Section icon={MapPin} title={isPickup ? 'Pickup' : 'Drop-off'}>
          <FieldGrid>
            <Field
              label="Method"
              value={isPickup ? 'Agent pickup' : 'You drop it off'}
            />
            {isPickup && <Field label="Date" value={niceDate(order.pickup_date)} />}
            <Field label="Contact" value={origin?.full_name} />
            <Field label="Phone" value={origin?.phone} />
            {origin?.company && <Field label="Company" value={origin.company} />}
          </FieldGrid>
          {originAddress && (
            <div className="mt-3.5">
              <p className="text-[11px] text-muted-foreground">
                {isPickup ? 'Pickup address' : 'Sender address'}
              </p>
              <p className="text-sm text-foreground mt-0.5 whitespace-pre-line leading-relaxed">
                {originAddress}
              </p>
            </div>
          )}
        </Section>

        {/* ─── Parcel ──────────────────────────────────────────────────── */}
        <Section icon={Package} title="Parcel">
          <FieldGrid>
            <Field label="Contents" value={itemStr(items, 'shipment_content')} />
            <Field label="Pieces" value={itemStr(items, 'pcs')} />
            <Field label="Weight" value={formatKg(order.booked_weight)} />
            {order.actual_weight != null && (
              <Field label="Weighed at hub" value={formatKg(order.actual_weight)} />
            )}
            <Field
              label="Packaging"
              value={order.packaging_required ? 'We pack it' : 'Already packed'}
            />
            <Field label="Dimensions" value={formatDimensions(items)} />
            <Field label="Declared value" value={formatDeclaredValue(items)} />
            <Field label="Product type" value={itemStr(items, 'product_code')} />
            <Field label="Service" value={itemStr(items, 'api_service_code')} />
            <Field label="Destination" value={consignee?.country_name} />
          </FieldGrid>

          {isCsbv && (
            <div className="mt-5 pt-4 border-t border-dashed border-border">
              <p className="text-[11px] font-bold tracking-[0.1em] uppercase text-muted-foreground mb-3">
                CSB V details
              </p>
              <FieldGrid>
                <Field label="HS code" value={hsCode(items)} />
                <Field label="Dispatch type" value={itemStr(items, 'dispatch_type')} />
                <Field
                  label="E-commerce"
                  value={itemStr(items, 'is_ecommerce') === 'yes' ? 'Yes' : 'No'}
                />
                <Field
                  label="Under scheme"
                  value={itemStr(items, 'is_scheme') === 'yes' ? 'Yes' : 'No'}
                />
                <Field
                  label="Tax basis"
                  value={itemStr(items, 'is_bond_ut') === 'bond_ut' ? 'Bond / LUT' : 'IGST'}
                />
                <Field label="LUT number" value={itemStr(items, 'lut_number')} />
              </FieldGrid>
            </div>
          )}
        </Section>

        {/* ─── Recipient ───────────────────────────────────────────────── */}
        <Section icon={User} title="Recipient">
          <FieldGrid>
            <Field label="Name" value={consignee?.name} />
            <Field label="Company" value={consignee?.company} />
            <Field label="Phone" value={consignee?.phone} />
            <Field label="Email" value={consignee?.email} />
          </FieldGrid>
          {consigneeAddress && (
            <div className="mt-3.5">
              <p className="text-[11px] text-muted-foreground">Delivery address</p>
              <p className="text-sm text-foreground mt-0.5 whitespace-pre-line leading-relaxed">
                {consigneeAddress}
              </p>
            </div>
          )}
        </Section>

        {/* ─── Payment ─────────────────────────────────────────────────── */}
        <Section icon={Wallet} title="Payment">
          <FieldGrid>
            <Field label="Method" value={paymentMethodLabel(order.payment_method)} />
            <Field label="Status" value={paymentStatusLabel(order.payment_status)} />
            <Field label="Quoted" value={formatInr(order.quoted_amount)} />
            {order.final_amount != null && (
              <Field label="Final" value={formatInr(order.final_amount)} />
            )}
            {order.awb_no && <Field label="AWB" value={order.awb_no} />}
          </FieldGrid>

          {payments.length > 0 && (
            <ul className="mt-4 space-y-2">
              {payments.map((p) => (
                <li
                  key={p.id}
                  className="rounded-lg border border-border bg-white px-3.5 py-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground tabular-nums">
                      {formatInr(p.amount) ?? `${p.currency} ${p.amount}`}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {paymentMethodLabel(p.method)}
                      {p.collectedByName && ` · collected by ${p.collectedByName}`}
                    </p>
                    {p.reference && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 break-all">
                        Ref {p.reference}
                      </p>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 text-right">
                    {niceDate(p.collectedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Pay-now orders that are still owed money. Cancelled orders are
              excluded — nothing to pay for — and so is `partially_paid`,
              which is a reprice at the hub and settles there, not here. */}
          {order.payment_method === 'pay_now' &&
            order.payment_status === 'pending' &&
            order.status !== 'cancelled' && (
              <>
                {/* TEMPORARY — only renders when the server has
                    PAYMENTS_TEST_MODE set. */}
                <PaymentTestModeSwitch className="mt-4" />
                <Button
                  className="mt-3 w-full h-11 rounded-lg"
                  disabled={paying}
                  onClick={() => void handlePayNow(order.id)}
                  data-testid="button-pay-now"
                >
                  {paying ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    `Pay ${formatInr(order.final_amount ?? order.quoted_amount) ?? 'now'}`
                  )}
                </Button>
              </>
            )}

          {/* COD never produces a payments row — an empty list here would
              otherwise read as "nothing was ever paid". */}
          {order.is_cod && (
            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
              Cash on delivery — the recipient pays on arrival, so nothing is
              collected from you.
            </p>
          )}
        </Section>

        {/* ─── Cancellation ────────────────────────────────────────────── */}
        {/* A request already with the team. Deliberately not styled as a
            success: nothing has been cancelled yet, and the pickup stands. */}
        {cancelPending && (
          <div
            className="mt-8 pt-6 border-t border-border"
            data-testid="banner-cancellation-pending"
          >
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">
                Cancellation requested
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                Our team is reviewing your request
                {cancellationRequest?.requestedAt
                  ? ` from ${niceDate(cancellationRequest.requestedAt)}`
                  : ''}
                . Until they confirm, this order is still going ahead — please keep
                your parcel ready.
              </p>
              {cancellationRequest?.reason && (
                <p className="mt-2 text-xs italic text-amber-800">
                  “{cancellationRequest.reason}”
                </p>
              )}
              <Link
                href="/orders"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 underline underline-offset-2"
              >
                Track this in My Orders
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        )}

        {/* Declined. The order is unchanged and the customer may ask again —
            the request button below reappears, because `hasOpenCancellationRequest`
            reads a rejected request as closed. */}
        {cancellationRequest?.state === 'rejected' && (
          <div
            className="mt-8 pt-6 border-t border-border"
            data-testid="banner-cancellation-declined"
          >
            <div className="rounded-lg border border-red-100 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-900">Cancellation declined</p>
              <p className="mt-1 text-xs leading-relaxed text-red-800">
                {cancellationRequest.decisionNote ??
                  'Our team could not cancel this order. It is still going ahead as booked.'}
              </p>
              <a
                href="tel:+912266400000"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-red-900 underline underline-offset-2"
              >
                <Phone className="w-3 h-3" />
                Call the Bombino team
              </a>
            </div>
          </div>
        )}

        {canRequestCancel && (
          <div className="mt-8 pt-6 border-t border-border">
            <Button
              variant="outline"
              className="w-full h-11 rounded-lg border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setCancelOpen(true)}
              data-testid="button-request-cancellation"
            >
              Request cancellation
            </Button>
            <p className="mt-2 text-[11px] text-muted-foreground text-center">
              You can ask us to cancel until an agent collects your parcel. Our
              team confirms every cancellation.
            </p>
          </div>
        )}
      </div>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Request cancellation?</AlertDialogTitle>
            <AlertDialogDescription>
              This sends {orderNo} to our team to review. It is not cancelled yet —
              your pickup stands until they confirm.
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
