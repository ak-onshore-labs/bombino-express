import type { KeyboardEvent, MouseEvent } from 'react';
import { ChevronRight, Copy, MapPin, Package } from 'lucide-react';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/StatusBadge';
import { formatInr } from '@/lib/orderDetail';
import { getCustomerStatusLabel, getOrderStatusTone } from '@/lib/orderStatus';
import { useToast } from '@/hooks/use-toast';
import {
  ORDER_PAYMENT_META,
  formatOrderDate,
  type GuestOrderSummary,
} from '@/lib/shadowProfile';

/**
 * A guest's bookings, wherever they need to be shown.
 *
 * Extracted from the guest profile screen so Home can render the same list
 * rather than a lookalike: two copies of a card that quotes an order number
 * and a payment state is two places for them to disagree.
 *
 * `/orders` lists the same bookings as rows (see guestOrderToRow), and each
 * opens the order screen, which answers a verified guest too. This list is a
 * record of what we were told, not live tracking, and nothing here polls.
 */

interface GuestOrdersProps {
  orders: GuestOrderSummary[];
  /**
   * Cap the list. Home passes a small number and links to the profile for the
   * rest; the profile screen passes nothing and shows them all.
   */
  limit?: number;
  /** Show the "View all" link when the list is capped. */
  showViewAll?: boolean;
  className?: string;
}

export function GuestOrders({
  orders,
  limit,
  showViewAll = false,
  className,
}: GuestOrdersProps): React.JSX.Element | null {
  const { toast } = useToast();

  if (orders.length === 0) return null;

  const shown = typeof limit === 'number' ? orders.slice(0, limit) : orders;
  const hiddenCount = orders.length - shown.length;

  const copyOrderNo = (orderNo: string): void => {
    void navigator.clipboard
      .writeText(orderNo)
      .then(() => toast({ title: 'Copied', description: `${orderNo} copied to clipboard` }))
      // Clipboard access can be refused outright (an insecure origin, or a
      // permission the customer denied); saying so beats a tap that does
      // nothing at all.
      .catch(() =>
        toast({
          title: 'Could not copy',
          description: 'Select the order ID and copy it manually.',
          variant: 'destructive',
        })
      );
  };

  return (
    <section className={className} data-testid="guest-profile-orders">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Your orders</h2>
        {hiddenCount > 0 && showViewAll ? (
          <Link
            href="/guest-profile"
            className="text-xs font-semibold text-primary underline underline-offset-4"
            data-testid="link-guest-orders-all"
          >
            View all {orders.length}
          </Link>
        ) : (
          <p className="text-xs text-muted-foreground">
            {orders.length === 1 ? '1 booking' : `${orders.length} bookings`}
          </p>
        )}
      </div>

      <div className="space-y-3">
        {shown.map((order) => (
          <GuestOrderCard
            key={order.order_no}
            order={order}
            onCopy={() => copyOrderNo(order.order_no)}
          />
        ))}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Filed against your verified number. Quote the order ID to support.
      </p>
    </section>
  );
}

/** `UNITED STATES` arrives shouting from the booking; say it like a place. */
function placeName(value: string | null): string {
  const v = value?.trim();
  if (!v) return '';
  return v === v.toUpperCase() ? v.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : v;
}

/**
 * One booking: where it is, who it is going to, and what is owed.
 *
 * The whole card opens the order. The order number still copies on its own —
 * support asks for it by phone — so it is a button that stops the tap reaching
 * the link.
 */
function GuestOrderCard({
  order,
  onCopy,
}: {
  order: GuestOrderSummary;
  onCopy: () => void;
}): React.JSX.Element {
  const payment = ORDER_PAYMENT_META[order.payment_status];
  const owed = order.payment_status !== 'paid' && order.payment_status !== 'refund_due';
  const amount = formatInr(order.final_amount ?? order.quoted_amount);
  const place = [placeName(order.city), placeName(order.country)].filter(Boolean).join(', ')
    || placeName(order.destination);

  const copy = (event: MouseEvent | KeyboardEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    onCopy();
  };

  return (
    <Link
      href={`/order/${encodeURIComponent(order.order_no)}`}
      className="block overflow-hidden rounded-xl border border-[rgba(198,40,40,0.08)] bg-card shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-card-hover active:translate-y-0 active:scale-[0.99]"
      data-testid={`guest-order-${order.order_no}`}
    >
      <div className="flex items-start gap-3 p-4">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          aria-hidden
        >
          <Package className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span
              role="button"
              tabIndex={0}
              onClick={copy}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && copy(e)}
              aria-label={`Copy ${order.order_no}`}
              className="-m-1 flex min-h-8 min-w-0 items-center gap-1.5 rounded-md p-1 hover:bg-muted"
              data-testid={`button-copy-order-${order.order_no}`}
            >
              <span className="truncate text-sm font-bold tabular-nums text-foreground">
                {order.order_no}
              </span>
              <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </span>
            <StatusBadge
              status={getCustomerStatusLabel(order.status)}
              tone={getOrderStatusTone(order.status)}
              className="shrink-0"
            />
          </div>

          <p className="mt-2 truncate text-base font-semibold leading-tight text-foreground">
            {order.recipient?.trim() || 'Recipient'}
          </p>
          {place && (
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{place}</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[rgba(198,40,40,0.06)] bg-[#FBF8F7] px-4 py-3">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          Booked {formatOrderDate(order.created_at)}
          {order.awb_no ? ` · AWB ${order.awb_no}` : ''}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {amount && (
            <span className="text-right leading-tight">
              <span
                className={cn(
                  'block text-sm font-bold tabular-nums',
                  owed ? 'text-[#B4690E]' : 'text-foreground'
                )}
              >
                {amount}
              </span>
              {payment && (
                <span
                  className={cn(
                    'block text-[11px] font-semibold',
                    owed ? 'text-[#B4690E]' : 'text-muted-foreground'
                  )}
                >
                  {payment.label}
                </span>
              )}
            </span>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
      </div>
    </Link>
  );
}
