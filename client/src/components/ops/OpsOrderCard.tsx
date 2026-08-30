import { Link } from 'wouter';
import { MapPin, Package } from 'lucide-react';
import { getOrderStatusLabel } from '@/lib/orderStatus';
import {
  formatInr,
  formatIst,
  paymentMethodLabel,
  paymentStatusLabel,
} from '@/lib/orderDetail';
import type { OpsBoardOrder } from '@/hooks/useOpsOrders';

function paymentLabel(order: OpsBoardOrder): string {
  if (order.is_cod || order.payment_method === 'cod') return 'COD';
  return `${paymentMethodLabel(order.payment_method)} · ${paymentStatusLabel(order.payment_status)}`;
}

/**
 * One order on the ops board — divided block, not a nested card.
 * Status weight over colour; amber reserved for money (PRODUCT.md).
 */
export function OpsOrderCard({ order }: { order: OpsBoardOrder }) {
  const amount =
    formatInr(order.final_amount) ?? formatInr(order.quoted_amount);
  const where = [order.consignee_name, order.consignee_city]
    .filter(Boolean)
    .join(' · ');
  const mode = order.pickup_request === 2 ? 'Drop-off' : 'Pickup';
  const unpaid =
    order.is_cod || order.payment_method === 'cod' || order.payment_status !== 'paid';

  return (
    <Link
      href={`/ops/orders/${order.id}`}
      className="block border-b border-border last:border-b-0 py-3 px-1 active:bg-muted/40 transition-colors"
      data-testid={`ops-order-card-${order.order_no}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-base font-extrabold text-foreground leading-tight">
          {getOrderStatusLabel(order.status)}
        </p>
        <span className="text-[11px] font-semibold text-muted-foreground tabular-nums shrink-0">
          {order.order_no}
        </span>
      </div>

      <p className="mt-1.5 text-sm font-semibold text-foreground leading-snug">
        {where || 'Consignee unavailable'}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Package className="w-3.5 h-3.5" aria-hidden />
          {mode}
        </span>
        {order.pickup_date && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" aria-hidden />
            {order.pickup_date}
          </span>
        )}
        {order.pickup_request === 1 && (
          <span
            className="inline-flex items-center rounded-md bg-[#F3F4F6] px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
            data-testid={`ops-agent-badge-${order.order_no}`}
          >
            {order.agent_id ? order.agent_name || 'Assigned' : 'Unassigned'}
          </span>
        )}
      </div>

      <p
        className={
          unpaid
            ? 'mt-2 text-xs font-bold text-[#F2A123]'
            : 'mt-2 text-xs font-medium text-muted-foreground'
        }
      >
        {paymentLabel(order)}
        {amount ? ` · ${amount}` : ''}
      </p>

      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
        {formatIst(order.created_at)}
        {order.awb_no ? ` · ${order.awb_no}` : ''}
      </p>
    </Link>
  );
}
