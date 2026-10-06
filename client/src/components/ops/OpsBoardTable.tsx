import { Link, useLocation } from 'wouter';
import { StatusBadge } from '@/components/StatusBadge';
import { OpsSenderCell } from '@/components/ops/OpsSenderCell';
import type { OpsBoardOrder } from '@/hooks/useOpsOrders';
import {
  formatInr,
  formatIst,
  formatIstDate,
  paymentMethodLabel,
  paymentStatusLabel,
} from '@/lib/orderDetail';
import { getOrderStatusLabel, getOrderStatusTone } from '@/lib/orderStatus';
import { OPS_PHASES, phaseIdForStatus } from '@/lib/opsPhases';

const PHASE_LABEL: Record<string, string> = Object.fromEntries(
  OPS_PHASES.map((phase) => [phase.id, phase.label]),
);

function stageLabel(status: string): string {
  return PHASE_LABEL[phaseIdForStatus(status)] ?? phaseIdForStatus(status);
}

function AwbCell({ order }: { order: OpsBoardOrder }) {
  if (order.awb_no) return <span className="font-mono text-[13px]">{order.awb_no}</span>;
  if (!order.docket_error) return <span className="text-muted-foreground">Not yet</span>;
  return (
    <span
      className="font-semibold text-destructive"
      title={order.docket_error}
      data-testid={`ops-docket-failed-row-${order.order_no}`}
    >
      {order.docket_retry === 'auto'
        ? 'Retrying'
        : order.docket_retry === 'check_itd'
          ? 'Check ITD'
          : 'Failed'}
    </span>
  );
}

/**
 * Every board order as one row, every field visible. Desktop and tablet only;
 * phones get the cards. Nothing is cut off: cells wrap, and the frame scrolls
 * sideways before a column is squeezed. The whole row opens the order.
 */
export function OpsBoardTable({
  orders,
  showStage,
}: {
  orders: OpsBoardOrder[];
  showStage: boolean;
}) {
  const [, setLocation] = useLocation();

  return (
    <div className="hidden md:block ops-table-frame" data-testid="ops-board-table">
      <table className="ops-table min-w-[900px]">
        <thead>
          <tr>
            <th>Order</th>
            <th>Status</th>
            <th>Sender</th>
            <th>Going to</th>
            <th>Agent</th>
            <th className="num">Payment</th>
            <th>AWB</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const href = `/ops/orders/${order.id}`;
            const amount = formatInr(order.final_amount) ?? formatInr(order.quoted_amount);
            const isDropoff = order.pickup_request === 2;
            const cod = order.is_cod || order.payment_method === 'cod';
            return (
              <tr
                key={order.id}
                data-href={href}
                onClick={(event) => {
                  // Links and buttons inside the row keep their own behaviour.
                  if ((event.target as HTMLElement).closest('a,button')) return;
                  setLocation(href);
                }}
                data-testid={`ops-board-row-${order.order_no}`}
              >
                <td className="nowrap">
                  <Link href={href} className="font-semibold text-foreground hover:underline">
                    {order.order_no}
                  </Link>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isDropoff ? 'Drop-off' : `Pickup on ${formatIstDate(order.pickup_date)}`}
                  </p>
                  <p className="text-xs text-muted-foreground">Booked {formatIst(order.created_at)}</p>
                </td>
                <td className="nowrap">
                  <StatusBadge
                    status={getOrderStatusLabel(order.status)}
                    tone={getOrderStatusTone(order.status)}
                  />
                  {showStage && (
                    <p className="text-xs text-muted-foreground mt-1">{stageLabel(order.status)}</p>
                  )}
                </td>
                <td>
                  <OpsSenderCell order={order} />
                </td>
                <td>
                  <p className="text-foreground">{order.consignee_name || 'Not given'}</p>
                  {order.consignee_city && (
                    <p className="text-xs text-muted-foreground mt-0.5">{order.consignee_city}</p>
                  )}
                </td>
                <td>
                  {order.agent_id ? (
                    order.agent_name || 'Assigned'
                  ) : isDropoff ? (
                    <span className="text-muted-foreground">Not needed</span>
                  ) : (
                    <span className="font-semibold text-[#B45309]">No agent yet</span>
                  )}
                </td>
                <td className="num">
                  <p className="font-semibold text-foreground">{amount ?? '—'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {cod
                      ? 'COD'
                      : `${paymentMethodLabel(order.payment_method)} · ${paymentStatusLabel(order.payment_status)}`}
                  </p>
                </td>
                <td className="nowrap">
                  <AwbCell order={order} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
