import { useEffect, useMemo, useState } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { useLocation } from 'wouter';
import {
  matchesOpsSection,
  type OpsBoardSection,
} from '@shared/opsBoardQuery';
import { nowInIst } from '@shared/pickupSlots';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsOrderCard } from '@/components/ops/OpsOrderCard';
import {
  OpsBoardFilterBar,
  type OpsBoardView,
} from '@/components/ops/OpsBoardFilterBar';
import { OpsBoardTable } from '@/components/ops/OpsBoardTable';
import { BandHeader } from '@/components/agent/BandHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  fetchOpsOrdersExport,
  useOpsBoardFiltered,
  useOpsOrders,
  type OpsBoardOrder,
} from '@/hooks/useOpsOrders';
import {
  useOpsBoardFilters,
  type OpsFilterConfig,
} from '@/hooks/useOpsBoardFilters';
import { downloadCsv } from '@/lib/csv';
import {
  formatIst,
  paymentMethodLabel,
  paymentStatusLabel,
} from '@/lib/orderDetail';
import { getOrderStatusLabel } from '@/lib/orderStatus';
import { OPS_PHASES, groupOrdersByPhase } from '@/lib/opsPhases';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const STAGE_PHASES = OPS_PHASES.filter(
  (p) => p.showAsColumn && p.id !== 'dispatched' && p.id !== 'cancelled'
);

const COL_CLASS: Record<number, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
};

const ORDER_CSV_HEADERS = [
  'order_no',
  'status',
  'mode',
  'consignee_name',
  'consignee_city',
  'agent_name',
  'payment_method',
  'payment_status',
  'is_cod',
  'quoted_amount',
  'final_amount',
  'created_at',
  'pickup_date',
  'awb_no',
] as const;

function orderToCsvRow(order: OpsBoardOrder): (string | number)[] {
  const isCod = order.is_cod || order.payment_method === 'cod';
  return [
    order.order_no,
    getOrderStatusLabel(order.status),
    order.pickup_request === 2 ? 'Drop-off' : 'Pickup',
    order.consignee_name ?? '',
    order.consignee_city ?? '',
    order.agent_id ? order.agent_name || 'Assigned' : 'Unassigned',
    paymentMethodLabel(order.payment_method),
    paymentStatusLabel(order.payment_status),
    isCod ? 'Yes' : 'No',
    order.quoted_amount ?? '',
    order.final_amount ?? '',
    formatIst(order.created_at),
    order.pickup_date ?? '',
    order.awb_no ?? '',
  ];
}

function orderExportFilename(
  section: OpsBoardSection,
  dateRange: string,
): string {
  const date = nowInIst().date;
  const rangeHint = dateRange !== 'all' ? `-${dateRange}` : '';
  return `bombino-${section}${rangeHint}-${date}.csv`;
}

function OrderList({ orders }: { orders: OpsBoardOrder[] }) {
  return (
    <>
      {orders.map((order) => (
        <OpsOrderCard key={order.id} order={order} />
      ))}
    </>
  );
}

/**
 * Pickups / Drop-offs / Dispatched — default uses capped GET /api/ops/orders;
 * when filters or search are active, switches to uncapped export query.
 */
export function OpsSectionBoard({
  title,
  subtitle,
  section,
  mode,
  filterConfig,
}: {
  title: string;
  subtitle: string;
  section: OpsBoardSection;
  mode: 'stages' | 'flat';
  filterConfig: OpsFilterConfig;
}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { logout } = useAppStore();
  const {
    data: orders,
    isLoading: cappedLoading,
    error,
    isError,
  } = useOpsOrders();
  const [exporting, setExporting] = useState(false);
  const [view, setView] = useState<OpsBoardView>('cards');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const forbidden =
    isError &&
    error instanceof Error &&
    error.message.startsWith('403:');

  const handleLogout = async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
    logout();
    setLocation('/login');
  };

  const sectionOrders = useMemo(
    () => (orders ?? []).filter((order) => matchesOpsSection(order, section)),
    [orders, section]
  );

  const {
    visible: cappedVisible,
    filters,
    setFilters,
    sort,
    setSort,
    query,
    setQuery,
    activeCount,
    clear,
  } = useOpsBoardFilters(sectionOrders, filterConfig);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query]);

  const trimmedDebounced = debouncedQuery.trim();
  const needsUncapped = activeCount > 0 || trimmedDebounced.length > 0;

  const filteredQuery = useOpsBoardFiltered({
    section,
    filters,
    sort,
    query: trimmedDebounced,
    enabled: needsUncapped,
  });

  const visible = needsUncapped
    ? (filteredQuery.data ?? [])
    : cappedVisible;

  const hideCardsOnDesktop = view === 'table';
  const listRefreshing =
    needsUncapped && filteredQuery.isFetching && !!filteredQuery.data;
  const listFirstFetch =
    needsUncapped && filteredQuery.isFetching && !filteredQuery.data;
  const showCappedSpinner = !needsUncapped && cappedLoading;
  const showListSpinner = listFirstFetch;

  const handleDownload = async (): Promise<void> => {
    setExporting(true);
    try {
      const exported = await fetchOpsOrdersExport({
        section,
        assignment: filters.assignment,
        stage: filters.stage,
        dateField: filters.dateField,
        dateRange: filters.dateRange,
        paymentMethod: filters.paymentMethod,
        q: query.trim() || undefined,
        sort,
      });
      if (exported.length === 0) {
        toast({
          title: 'No export data',
          description: 'No orders match the current filters.',
        });
        return;
      }
      downloadCsv(
        orderExportFilename(section, filters.dateRange),
        [...ORDER_CSV_HEADERS],
        exported.map(orderToCsvRow),
      );
    } catch {
      toast({
        title: 'Export failed',
        description: 'Could not download orders. Try again.',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  if (forbidden) {
    return (
      <OpsShell title="Operations" subtitle="Access required">
        <div
          className="rounded-2xl border border-border bg-white p-6 text-center"
          data-testid="ops-forbidden"
        >
          <p className="text-base font-semibold text-foreground">Ops access required</p>
          <p className="text-sm text-muted-foreground mt-2">
            This account does not have the admin role. Sign out and use an ops account.
          </p>
          <Button
            type="button"
            onClick={() => void handleLogout()}
            className="mt-5 bg-[#F2A123] hover:bg-[#F2A123]/90 text-[lab(34.0831_-9.57756_-27.7093)] font-semibold"
            data-testid="button-ops-forbidden-logout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </Button>
        </div>
      </OpsShell>
    );
  }

  if (isError && !forbidden) {
    return (
      <OpsShell title={title} subtitle={subtitle} wide>
        <p className="text-sm text-red-600 py-8 text-center" data-testid="ops-board-error">
          Could not load orders. Try refreshing.
        </p>
      </OpsShell>
    );
  }

  const grouped = groupOrdersByPhase(visible);
  const filledPhases = STAGE_PHASES.filter((phase) => grouped[phase.id].length > 0);
  const colClass = COL_CLASS[filledPhases.length] ?? 'md:grid-cols-3';

  const showEmptySection =
    !needsUncapped && !cappedLoading && sectionOrders.length === 0;
  const showNoMatchesCapped =
    !needsUncapped &&
    !cappedLoading &&
    sectionOrders.length > 0 &&
    visible.length === 0;
  const showNoMatchesFiltered =
    needsUncapped &&
    !filteredQuery.isFetching &&
    !filteredQuery.isError &&
    visible.length === 0;
  const showFilteredError =
    needsUncapped && filteredQuery.isError && !filteredQuery.data;

  return (
    <OpsShell title={title} subtitle={subtitle} wide>
      <OpsBoardFilterBar
        config={filterConfig}
        filters={filters}
        setFilters={setFilters}
        sort={sort}
        setSort={setSort}
        query={query}
        setQuery={setQuery}
        activeCount={activeCount}
        onClear={clear}
        view={view}
        setView={setView}
        onDownload={() => void handleDownload()}
        downloadBusy={exporting}
        windowMode={needsUncapped ? 'filtered' : 'capped'}
        matchCount={needsUncapped ? visible.length : undefined}
      />

      {(showCappedSpinner || showListSpinner) && (
        <div className="flex justify-center py-16" data-testid="ops-board-loading">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {showFilteredError && (
        <p className="text-sm text-red-600 py-8 text-center" data-testid="ops-board-filtered-error">
          Could not load filtered orders. Try again.
        </p>
      )}

      {showEmptySection && (
        <p className="text-sm text-muted-foreground py-12 text-center" data-testid="ops-board-empty">
          No orders in this section.
        </p>
      )}

      {showNoMatchesCapped && (
        <div className="py-12 text-center" data-testid="ops-board-no-matches">
          <p className="text-sm text-muted-foreground">
            {query.trim().length > 0 && activeCount === 0
              ? 'No matches'
              : 'No orders match these filters. Among the latest 200 orders.'}
          </p>
          {activeCount > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-3"
              onClick={clear}
              data-testid="ops-filters-clear-empty"
            >
              Clear filters
            </Button>
          )}
        </div>
      )}

      {showNoMatchesFiltered && (
        <div className="py-12 text-center" data-testid="ops-board-no-matches">
          <p className="text-sm text-muted-foreground">
            No orders match these filters.
          </p>
          {activeCount > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-3"
              onClick={clear}
              data-testid="ops-filters-clear-empty"
            >
              Clear filters
            </Button>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <div
          className={cn(listRefreshing && 'opacity-60 transition-opacity')}
          data-testid="ops-board-list"
        >
          {view === 'table' && (
            <OpsBoardTable orders={visible} showStage={mode === 'stages'} />
          )}

          {mode === 'flat' && (
            <div
              className={cn(
                'rounded-2xl border border-border bg-white px-3 divide-y divide-border',
                hideCardsOnDesktop && 'md:hidden',
              )}
              data-testid="ops-board-flat"
            >
              <OrderList orders={visible} />
            </div>
          )}

          {mode === 'stages' && filledPhases.length > 0 && (
            <>
              <div
                className={cn(
                  'md:gap-4 md:items-start',
                  colClass,
                  hideCardsOnDesktop ? 'hidden' : 'hidden md:grid',
                )}
                data-testid="ops-board-columns"
              >
                {filledPhases.map((phase) => {
                  const list = grouped[phase.id];
                  return (
                    <section
                      key={phase.id}
                      className="min-w-0 rounded-2xl border border-border bg-white overflow-hidden"
                      data-testid={`ops-phase-col-${phase.id}`}
                    >
                      <div className="px-3 pt-3 flex items-start justify-between gap-2">
                        <BandHeader label={phase.label} />
                        <span className="text-xs font-semibold text-muted-foreground tabular-nums shrink-0">
                          {list.length}
                        </span>
                      </div>
                      <div className="px-3 pb-2 divide-y divide-border">
                        <OrderList orders={list} />
                      </div>
                    </section>
                  );
                })}
              </div>

              <div className="md:hidden space-y-6" data-testid="ops-board-mobile">
                {filledPhases.map((phase) => {
                  const list = grouped[phase.id];
                  return (
                    <section key={phase.id} data-testid={`ops-phase-mobile-${phase.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <BandHeader label={phase.label} />
                        <span className="text-xs font-semibold text-muted-foreground tabular-nums shrink-0">
                          {list.length}
                        </span>
                      </div>
                      <div className="rounded-2xl border border-border bg-white px-3 divide-y divide-border">
                        <OrderList orders={list} />
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </OpsShell>
  );
}
