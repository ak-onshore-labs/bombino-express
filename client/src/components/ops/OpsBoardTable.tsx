import { Link } from 'wouter';
import { StatusBadge } from '@/components/StatusBadge';
import type { OpsBoardOrder } from '@/hooks/useOpsOrders';
import {
  formatInr,
  formatIst,
  paymentMethodLabel,
  paymentStatusLabel,
} from '@/lib/orderDetail';
import { getOrderStatusLabel, getOrderStatusTone } from '@/lib/orderStatus';
import { OPS_PHASES, phaseIdForStatus } from '@/lib/opsPhases';

const PHASE_LABEL: Record<string, string> = Object.fromEntries(
  OPS_PHASES.map((phase) => [phase.id, phase.label]),
);

function paymentLabel(order: OpsBoardOrder): string {
  if (order.is_cod || order.payment_method === 'cod') return 'COD';
  return `${paymentMethodLabel(order.payment_method)} · ${paymentStatusLabel(order.payment_status)}`;
}

function consigneeLabel(order: OpsBoardOrder): string {
  return (
    [order.consignee_name, order.consignee_city].filter(Boolean).join(' · ') ||
    'Consignee unavailable'
  );
}

function agentLabel(order: OpsBoardOrder): string {
  return order.agent_id ? order.agent_name || 'Assigned' : 'Unassigned';
}

function stageLabel(status: string): string {
  return PHASE_LABEL[phaseIdForStatus(status)] ?? phaseIdForStatus(status);
}

/**
 * Dense desktop scan of the same `visible` array the cards use.
 * One flat table — stages are a column, not nested tables. Hidden below md.
 */
export function OpsBoardTable({
  orders,
  showStage,
}: {
  orders: OpsBoardOrder[];
  showStage: boolean;
}) {
  return (
    <div
      className="hidden md:block rounded-2xl border border-border bg-white overflow-x-auto"
      data-testid="ops-board-table"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold text-muted-foreground border-b border-border">
            <th className="px-4 py-3">Order</th>
            {showStage && <th className="px-4 py-3">Stage</th>}
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Mode</th>
            <th className="px-4 py-3">Customer</th>
            <th className="px-4 py-3">Consignee</th>
            <th className="px-4 py-3">Agent</th>
            <th className="px-4 py-3">Payment</th>
            <th className="px-4 py-3">Amount</th>
            <th className="px-4 py-3">Age</th>
            <th className="px-4 py-3">AWB</th>
            <th className="px-4 py-3">Open</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const href = `/ops/orders/${order.id}`;
            const amount =
              formatInr(order.final_amount) ?? formatInr(order.quoted_amount);
            const mode = order.pickup_request === 2 ? 'Drop-off' : 'Pickup';
            return (
              <tr
                key={order.id}
                className="border-b border-border last:border-b-0"
                data-testid={`ops-board-row-${order.order_no}`}
              >
                <td className="px-4 py-3">
                  <Link
                    href={href}
                    className="font-semibold text-foreground hover:underline"
                  >
                    {order.order_no}
                  </Link>
                </td>
                {showStage && (
                  <td className="px-4 py-3 text-muted-foreground">
                    {stageLabel(order.status)}
                  </td>
                )}
                <td className="px-4 py-3">
                  <StatusBadge
                    status={getOrderStatusLabel(order.status)}
                    tone={getOrderStatusTone(order.status)}
                  />
                </td>
                <td className="px-4 py-3">{mode}</td>
                <td className="px-4 py-3">
                  {order.user_id ? (
                    <Link
                      href={`/ops/customers/${order.user_id}`}
                      className="font-semibold text-foreground hover:underline"
                      onClick={(event) => event.stopPropagation()}
                      data-testid={`ops-board-customer-${order.order_no}`}
                    >
                      {order.customer_name?.trim() || 'Customer'}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3">{consigneeLabel(order)}</td>
                <td className="px-4 py-3">{agentLabel(order)}</td>
                <td className="px-4 py-3">{paymentLabel(order)}</td>
                <td className="px-4 py-3 font-semibold tabular-nums">
                  {amount ?? '—'}
                </td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                  {formatIst(order.created_at)}
                </td>
                <td className="px-4 py-3">{order.awb_no ?? '—'}</td>
                <td className="px-4 py-3">
                  <Link
                    href={href}
                    className="font-semibold text-foreground hover:underline"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
