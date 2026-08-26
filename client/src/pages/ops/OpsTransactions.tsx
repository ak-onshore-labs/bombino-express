import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Download, Loader2, Search } from 'lucide-react';
import { nowInIst } from '@shared/pickupSlots';
import { OpsShell } from '@/components/ops/OpsShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  fetchOpsPaymentsExport,
  useOpsPayments,
  type OpsPaymentRange,
  type OpsPaymentRow,
} from '@/hooks/useOpsOrders';
import { downloadCsv } from '@/lib/csv';
import { formatInr, formatIst, paymentMethodLabel } from '@/lib/orderDetail';
import { cn } from '@/lib/utils';

function modeLabel(mode: OpsPaymentRow['collection_mode']): string {
  if (mode === 'cash') return 'Cash';
  if (mode === 'upi') return 'UPI';
  return '—';
}

const PAYMENT_CSV_HEADERS = [
  'order_no',
  'amount',
  'currency',
  'method',
  'collection_mode',
  'collector_name',
  'collected_at',
  'status',
  'txn_id',
  'reference',
] as const;

function paymentToCsvRow(row: OpsPaymentRow): (string | number)[] {
  return [
    row.order_no ?? '',
    row.amount,
    row.currency,
    paymentMethodLabel(row.method),
    row.collection_mode ?? '',
    row.collector_name,
    formatIst(row.collected_at),
    row.status,
    row.txn_id ?? '',
    row.reference ?? '',
  ];
}

export default function OpsTransactions() {
  const { toast } = useToast();
  const [range, setRange] = useState<OpsPaymentRange>('today');
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState(false);
  const { data, isLoading, isError } = useOpsPayments(range);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = data?.payments ?? [];
    if (!needle) return rows;
    return rows.filter((row) => (row.order_no ?? '').toLowerCase().includes(needle));
  }, [data?.payments, query]);

  const totals = data?.totals;

  const handleDownload = async (): Promise<void> => {
    setExporting(true);
    try {
      const payments = await fetchOpsPaymentsExport(range);
      const needle = query.trim().toLowerCase();
      const rows = needle
        ? payments.filter((row) => (row.order_no ?? '').toLowerCase().includes(needle))
        : payments;
      if (rows.length === 0) {
        toast({
          title: 'No export data',
          description: 'No transactions match the current range and search.',
        });
        return;
      }
      const filename = `bombino-transactions-${range}-${nowInIst().date}.csv`;
      downloadCsv(
        filename,
        [...PAYMENT_CSV_HEADERS],
        rows.map(paymentToCsvRow),
      );
    } catch {
      toast({
        title: 'Export failed',
        description: 'Could not download transactions. Try again.',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <OpsShell title="Transactions" subtitle="Payment ledger" wide>
      <div className="flex flex-wrap gap-2 mb-4" data-testid="ops-ledger-range">
        <Button
          type="button"
          size="sm"
          variant={range === 'today' ? 'default' : 'outline'}
          onClick={() => setRange('today')}
          data-testid="ops-ledger-range-today"
        >
          Today
        </Button>
        <Button
          type="button"
          size="sm"
          variant={range === '7d' ? 'default' : 'outline'}
          onClick={() => setRange('7d')}
          data-testid="ops-ledger-range-7d"
        >
          Last 7 days
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void handleDownload()}
          disabled={exporting || isLoading || isError}
          data-testid="ops-ledger-download"
        >
          {exporting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Download
        </Button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16" data-testid="ops-ledger-loading">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <p className="text-sm text-red-600 py-8 text-center" data-testid="ops-ledger-error">
          Could not load payments. Try refreshing.
        </p>
      )}

      {!isLoading && !isError && totals && (
        <div
          className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4"
          data-testid="ops-ledger-totals"
        >
          {(
            [
              ['All', totals.all],
              ['Cash', totals.cash],
              ['UPI', totals.upi],
              ['Gateway', totals.gateway],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="rounded-2xl border border-border bg-white px-4 py-3"
            >
              <p className="text-xs font-semibold text-muted-foreground">{label}</p>
              <p className="text-lg font-extrabold tabular-nums mt-1">
                {formatInr(value) ?? '₹0'}
              </p>
            </div>
          ))}
          <div className="rounded-2xl border border-border bg-white px-4 py-3">
            <p className="text-xs font-semibold text-muted-foreground">Count</p>
            <p className="text-lg font-extrabold tabular-nums mt-1">{totals.count}</p>
          </div>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className="relative mb-4">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search order no"
              className="h-11 pl-9 rounded-xl bg-white"
              data-testid="ops-ledger-search"
              aria-label="Search order no"
            />
          </div>

          {visible.length === 0 ? (
            <p
              className="text-sm text-muted-foreground py-12 text-center"
              data-testid="ops-ledger-empty"
            >
              No transactions
            </p>
          ) : (
            <>
              <div className="md:hidden rounded-2xl border border-border bg-white divide-y divide-border">
                {visible.map((row) => (
                  <LedgerRow key={row.id} row={row} stacked />
                ))}
              </div>
              <div className="hidden md:block rounded-2xl border border-border bg-white overflow-x-auto">
                <table className="w-full text-sm" data-testid="ops-ledger-table">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-muted-foreground border-b border-border">
                      <th className="px-4 py-3">Order</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Method</th>
                      <th className="px-4 py-3">Mode</th>
                      <th className="px-4 py-3">Collected by</th>
                      <th className="px-4 py-3">When</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <LedgerRow key={row.id} row={row} stacked={false} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}

function LedgerRow({ row, stacked }: { row: OpsPaymentRow; stacked: boolean }) {
  const amount = formatInr(row.amount) ?? '₹0';
  const href = `/ops/orders/${row.order_id}`;
  const orderLabel = row.order_no ?? row.order_id.slice(0, 8);
  const ref = row.txn_id ?? row.reference ?? '—';

  if (stacked) {
    return (
      <Link
        href={href}
        className="block px-4 py-3 active:bg-muted/40"
        data-testid={`ops-ledger-row-${row.id}`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-extrabold text-foreground">{orderLabel}</p>
          <p className="font-extrabold tabular-nums">{amount}</p>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {paymentMethodLabel(row.method)} · {modeLabel(row.collection_mode)} ·{' '}
          {row.collector_name}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatIst(row.collected_at)} · {row.status} · {ref}
        </p>
      </Link>
    );
  }

  return (
    <tr className="border-b border-border last:border-b-0" data-testid={`ops-ledger-row-${row.id}`}>
      <td className="px-4 py-3">
        <Link href={href} className="font-semibold text-foreground hover:underline">
          {orderLabel}
        </Link>
      </td>
      <td className="px-4 py-3 font-semibold tabular-nums">{amount}</td>
      <td className="px-4 py-3">{paymentMethodLabel(row.method)}</td>
      <td className="px-4 py-3">{modeLabel(row.collection_mode)}</td>
      <td className="px-4 py-3">{row.collector_name}</td>
      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
        {formatIst(row.collected_at)}
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize',
            'bg-gray-50 text-gray-700 border-gray-200'
          )}
        >
          {row.status}
        </span>
      </td>
      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{ref}</td>
    </tr>
  );
}
