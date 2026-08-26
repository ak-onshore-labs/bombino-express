import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Loader2, Search } from 'lucide-react';
import { OpsShell } from '@/components/ops/OpsShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { matchesOpsSection } from '@shared/opsBoardQuery';
import {
  useOpsCancellations,
  useOpsOrders,
  useOpsPayments,
} from '@/hooks/useOpsOrders';
import { formatInr, formatIst } from '@/lib/orderDetail';

function StockCard({
  label,
  count,
  href,
  testId,
}: {
  label: string;
  count: number;
  href?: string;
  testId: string;
}) {
  const body = (
    <>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="text-3xl font-extrabold tabular-nums mt-2" data-testid={testId}>
        {count}
      </p>
    </>
  );
  const className =
    'rounded-2xl border border-border bg-white px-4 py-4 block hover:bg-muted/30 transition-colors';
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

export default function OpsDashboard() {
  const [, setLocation] = useLocation();
  const [jump, setJump] = useState('');
  const [jumpError, setJumpError] = useState('');
  const ordersQuery = useOpsOrders();
  const moneyQuery = useOpsPayments('today');
  const cancellationsQuery = useOpsCancellations();

  const orders = ordersQuery.data ?? [];
  const counts = useMemo(
    () => ({
      pickups: orders.filter((order) => matchesOpsSection(order, 'pickups')).length,
      dropoffs: orders.filter((order) => matchesOpsSection(order, 'dropoffs')).length,
      weigh: orders.filter((order) => order.status === 'received_at_hub').length,
      settle: orders.filter((order) => order.status === 'weighed').length,
      dispatched: orders.filter((order) => matchesOpsSection(order, 'dispatched')).length,
      cod: orders.filter((order) => order.is_cod).length,
    }),
    [orders]
  );

  const handleJump = (event: React.FormEvent): void => {
    event.preventDefault();
    const needle = jump.trim().toLowerCase();
    if (!needle) return;
    const match = orders.find((order) => order.order_no.toLowerCase().includes(needle));
    if (!match) {
      setJumpError('Not in the latest 200 orders');
      return;
    }
    setJumpError('');
    setLocation(`/ops/orders/${match.id}`);
  };

  const totals = moneyQuery.data?.totals;
  const cancellations = cancellationsQuery.data?.cancellations ?? [];
  const cancelCount = cancellationsQuery.data?.count ?? 0;

  return (
    <OpsShell title="Dashboard" subtitle="Overview" wide>
      <form onSubmit={handleJump} className="relative mb-5" data-testid="ops-dash-jump">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
          aria-hidden
        />
        <Input
          type="search"
          value={jump}
          onChange={(event) => {
            setJump(event.target.value);
            setJumpError('');
          }}
          placeholder="Jump to order no"
          className="h-11 pl-9 pr-24 rounded-xl bg-white"
          data-testid="ops-dash-jump-input"
          aria-label="Jump to order no"
        />
        <Button
          type="submit"
          size="sm"
          className="absolute right-1.5 top-1/2 -translate-y-1/2"
          data-testid="ops-dash-jump-submit"
        >
          Go
        </Button>
        {jumpError && (
          <p className="text-xs text-red-600 mt-1.5" data-testid="ops-dash-jump-miss">
            {jumpError}
          </p>
        )}
      </form>

      {ordersQuery.isLoading && (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {ordersQuery.isError && (
        <p className="text-sm text-red-600 py-6 text-center">Could not load orders.</p>
      )}

      {!ordersQuery.isLoading && !ordersQuery.isError && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="ops-dash-stock">
            <StockCard
              label="Active pickups"
              count={counts.pickups}
              href="/ops/pickups"
              testId="ops-dash-count-pickups"
            />
            <StockCard
              label="Active drop-offs"
              count={counts.dropoffs}
              href="/ops/dropoffs"
              testId="ops-dash-count-dropoffs"
            />
            <StockCard
              label="Awaiting weigh"
              count={counts.weigh}
              testId="ops-dash-count-weigh"
            />
            <StockCard
              label="Awaiting settle"
              count={counts.settle}
              testId="ops-dash-count-settle"
            />
            <StockCard
              label="Dispatched"
              count={counts.dispatched}
              href="/ops/dispatched"
              testId="ops-dash-count-dispatched"
            />
            <StockCard label="COD" count={counts.cod} testId="ops-dash-count-cod" />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Counts from the latest 200 orders.
          </p>
        </>
      )}

      <Link
        href="/ops/transactions"
        className="mt-5 block rounded-2xl border border-border bg-white px-4 py-4 hover:bg-muted/30 transition-colors"
        data-testid="ops-dash-money"
      >
        <p className="text-xs font-semibold text-muted-foreground">Today’s money</p>
        {moneyQuery.isLoading && (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mt-3" />
        )}
        {moneyQuery.isError && (
          <p className="text-sm text-red-600 mt-2">Could not load today’s collections.</p>
        )}
        {totals && (
          <>
            <p className="text-3xl font-extrabold tabular-nums mt-2">
              {formatInr(totals.all) ?? '₹0'}
            </p>
            <p className="text-xs font-medium text-muted-foreground mt-2">
              Cash {formatInr(totals.cash) ?? '₹0'} · UPI {formatInr(totals.upi) ?? '₹0'} ·
              Gateway {formatInr(totals.gateway) ?? '₹0'}
            </p>
          </>
        )}
      </Link>

      <section
        className="mt-5 rounded-2xl border border-border bg-white px-4 py-4"
        data-testid="ops-dash-attention"
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold text-muted-foreground">Attention</p>
          <p className="text-xs font-semibold tabular-nums" data-testid="ops-dash-cancel-count">
            {cancelCount} pending
          </p>
        </div>
        {cancellationsQuery.isLoading && (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mt-3" />
        )}
        {cancellationsQuery.isError && (
          <p className="text-sm text-red-600 mt-2">Could not load cancellations.</p>
        )}
        {!cancellationsQuery.isLoading &&
          !cancellationsQuery.isError &&
          cancellations.length === 0 && (
            <p className="text-sm text-muted-foreground mt-3">No pending cancellations</p>
          )}
        {cancellations.length > 0 && (
          <ul className="mt-2 divide-y divide-border">
            {cancellations.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/ops/orders/${row.id}`}
                  className="block py-3 hover:bg-muted/30 -mx-1 px-1 rounded-lg"
                  data-testid={`ops-dash-cancel-${row.order_no}`}
                >
                  <p className="font-extrabold text-foreground">{row.order_no}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {row.reason || 'No reason given'} · {formatIst(row.requested_at)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </OpsShell>
  );
}
