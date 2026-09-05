import { Copy, Package } from 'lucide-react';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';
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
 * These orders exist nowhere else a guest can reach. `/orders` is an account
 * screen and `GET /api/orders/:orderNo` answers only to a `dbUserId`, so this
 * list is the only way the number they were shown once at booking comes back
 * to them. It is a record of what we were told, not live tracking — the copy
 * says so, and nothing here polls.
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

      <div className="space-y-2">
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

function GuestOrderCard({
  order,
  onCopy,
}: {
  order: GuestOrderSummary;
  onCopy: () => void;
}): React.JSX.Element {
  const payment = ORDER_PAYMENT_META[order.payment_status];

  return (
    <div
      className="rounded-xl border border-border bg-card p-3.5 shadow-sm"
      data-testid={`guest-order-${order.order_no}`}
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          aria-hidden
        >
          <Package className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            {/* The number is the whole point of the card, so it is the thing
                that copies — support asks for it by phone. */}
            <button
              type="button"
              onClick={onCopy}
              className="flex min-w-0 items-center gap-1.5 text-left"
              data-testid={`button-copy-order-${order.order_no}`}
            >
              <span className="truncate text-sm font-bold text-foreground">{order.order_no}</span>
              <Copy className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
            {payment && (
              <span
                className={cn(
                  'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                  payment.badge
                )}
              >
                {payment.label}
              </span>
            )}
          </div>

          {order.destination && (
            <p className="mt-1 break-words text-sm leading-snug text-foreground">
              To {order.destination}
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            Booked {formatOrderDate(order.created_at)}
            {order.awb_no ? ` · AWB ${order.awb_no}` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
