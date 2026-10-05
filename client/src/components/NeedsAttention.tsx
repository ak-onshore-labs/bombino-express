import { useMemo, type ReactElement, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { format, isToday, isTomorrow, parseISO, isValid } from 'date-fns';
import { navigateInApp } from '@/lib/biaNavigate';
import { attentionItems, type AttentionItem } from '@/lib/attention';
import { formatShipmentAmount, type DisplayRow } from '@/lib/shipmentRows';
import { StatusBadge } from '@/components/StatusBadge';
import {
  useCustomerOrderDetail,
  useMarkNotificationRead,
  type CustomerNotification,
} from '@/hooks/useCustomerOrders';

/**
 * Home's "Needs your attention" — replaces the old Recent Updates list, which
 * repeated My Shipments in notification form. Only things the customer must
 * act on: an OTP to read out, a payment to make, a decision to read.
 *
 * Drawn in My Shipments' own vocabulary (card-accent rows, the same heading
 * and the same two lines) so the two sections read as one family.
 *
 * Draws nothing when there is nothing to do, and nothing while the order list
 * is still loading, so it never flashes in and out.
 */
export function NeedsAttention({
  rows,
  bell,
  loading,
  className,
}: {
  rows: DisplayRow[];
  bell: CustomerNotification[];
  loading: boolean;
  className?: string;
}): ReactElement | null {
  const items = useMemo(() => attentionItems(rows, bell), [rows, bell]);
  if (loading || items.length === 0) return null;

  return (
    <section className={className} aria-labelledby="needs-attention-heading" data-testid="zone-needs-attention">
      <div className="flex items-center justify-between mb-3">
        <h2
          id="needs-attention-heading"
          className="text-sm font-medium text-foreground md:text-base md:font-semibold"
        >
          Needs your attention
        </h2>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <AttentionRow key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
}

/** My Shipments' row: card-accent, an id line with a badge, then a muted detail line. */
function Row({
  onClick,
  testId,
  ariaLabel,
  idLine,
  badge,
  detail,
  aside,
}: {
  onClick: () => void;
  testId: string;
  ariaLabel?: string;
  idLine: ReactNode;
  badge: ReactNode;
  detail: ReactNode;
  aside?: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="block w-full text-left card-accent hover:border-primary/25 active:scale-[0.99] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F2A123]"
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="min-w-0 truncate text-sm font-semibold tabular-nums tracking-[0.02em] text-foreground">
          {idLine}
        </span>
        {badge}
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0">{detail}</span>
        {aside}
      </div>
    </button>
  );
}

/** The "ORDER" chip and number, exactly as My Shipments prints an order. */
function OrderId({ orderNo }: { orderNo: string }): ReactElement {
  return (
    <>
      <span className="mr-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground bg-muted px-1.5 py-0.5 rounded align-middle">
        Order
      </span>
      {orderNo}
    </>
  );
}

function AttentionRow({ item }: { item: AttentionItem }): ReactElement | null {
  const [, setLocation] = useLocation();
  const markRead = useMarkNotificationRead();

  if (item.kind === 'otp') return <OtpRow item={item} />;

  if (item.kind === 'pay') {
    const amount = item.amount !== null ? formatShipmentAmount(item.amount, 'INR') : null;
    return (
      <Row
        onClick={() => navigateInApp(setLocation, `/order/${encodeURIComponent(item.orderNo)}#pay`)}
        testId={`attention-pay-${item.orderNo}`}
        idLine={<OrderId orderNo={item.orderNo} />}
        badge={<StatusBadge status="Payment due" tone="amber" className="shrink-0" />}
        detail="Pay to keep your shipment moving"
        aside={amount && <span className="font-semibold text-foreground tabular-nums">{amount}</span>}
      />
    );
  }

  return (
    <Row
      onClick={() => {
        markRead.mutate(item.notificationId);
        navigateInApp(setLocation, item.href);
      }}
      testId={`attention-notice-${item.notificationId}`}
      idLine={item.title}
      badge={
        <StatusBadge
          status={item.tone === 'warning' ? 'Action needed' : 'Update'}
          tone={item.tone === 'warning' ? 'amber' : 'blue'}
          className="shrink-0"
        />
      }
      detail={item.body}
    />
  );
}

function whenLine(item: Extract<AttentionItem, { kind: 'otp' }>): string {
  if (item.handover === 'dropoff') return 'Read this out at the Bombino counter';
  if (item.urgent) return 'Agent is on the way. Read this out at the door';
  const d = item.pickupDate ? parseISO(item.pickupDate) : null;
  if (d && isValid(d)) {
    if (isToday(d)) return 'Pickup today. Keep this ready';
    if (isTomorrow(d)) return 'Pickup tomorrow. Keep this ready';
    return `Pickup on ${format(d, 'MMM d')}. Keep this ready`;
  }
  return 'Keep this ready for the agent';
}

/**
 * The OTP row reads the code live from the order, never from a notification —
 * same rule as the bell (a code can be regenerated, and is spent at handover).
 */
function OtpRow({ item }: { item: Extract<AttentionItem, { kind: 'otp' }> }): ReactElement | null {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useCustomerOrderDetail(item.orderNo);
  const live = data?.handover;
  // The order moved on between the list and this read: nothing to show.
  if (!isLoading && (!live || live.kind !== item.handover)) return null;

  const label = item.handover === 'pickup' ? 'Pickup OTP' : 'Drop-off OTP';
  const needsNew = !!live && (live.locked || !live.code);

  return (
    <Row
      onClick={() => navigateInApp(setLocation, `/order/${encodeURIComponent(item.orderNo)}#handover-code`)}
      testId={`attention-otp-${item.orderNo}`}
      ariaLabel={
        live?.code && !live.locked
          ? `${label} for ${item.orderNo}: ${live.code.split('').join(' ')}`
          : `${label} for ${item.orderNo}`
      }
      idLine={<OrderId orderNo={item.orderNo} />}
      badge={<StatusBadge status={label} tone="amber" className="shrink-0" />}
      detail={
        needsNew ? (
          <span className="text-amber-800">
            {live?.locked ? 'Locked after wrong attempts. Tap to get a new OTP' : 'No OTP yet. Tap to generate one'}
          </span>
        ) : (
          whenLine(item)
        )
      }
      aside={
        isLoading ? (
          <span className="h-5 w-14 shrink-0 rounded bg-gray-100 animate-pulse motion-reduce:animate-none" aria-hidden />
        ) : needsNew ? null : (
          <span
            className="shrink-0 font-mono text-lg font-bold leading-none tracking-[0.18em] tabular-nums text-foreground"
            data-testid="text-attention-otp"
          >
            {live?.code}
          </span>
        )
      }
    />
  );
}
