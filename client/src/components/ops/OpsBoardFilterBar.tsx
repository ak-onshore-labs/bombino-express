import { forwardRef, useState, type ComponentProps, type Dispatch, type SetStateAction } from 'react';
import { Download, ListFilter, Loader2, Search, X } from 'lucide-react';
import { OpsFilterPanel } from '@/components/ops/OpsFilterPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { paymentMethodLabel } from '@/lib/orderDetail';
import {
  dateRangesForField,
  type OpsBoardFilters,
  type OpsBoardSort,
  type OpsFilterConfig,
} from '@/hooks/useOpsBoardFilters';
import { cn } from '@/lib/utils';

const STAGE_PILL: Record<string, string> = {
  inbound: 'Inbound',
  hub: 'Hub',
  settled: 'Settled',
};

function datePillLabel(filters: OpsBoardFilters): string {
  const option = dateRangesForField(filters.dateField).find(
    (entry) => entry.value === filters.dateRange,
  );
  const range = option?.label ?? filters.dateRange;
  const field = filters.dateField === 'pickup' ? 'Pickup' : 'Booking';
  return `${field} · ${range}`;
}

export type OpsBoardView = 'cards' | 'table';

function SortToggle({
  sort,
  setSort,
}: {
  sort: OpsBoardSort;
  setSort: Dispatch<SetStateAction<OpsBoardSort>>;
}) {
  return (
    <div className="flex gap-1 shrink-0">
      <Button
        type="button"
        size="sm"
        variant={sort === 'newest' ? 'default' : 'outline'}
        onClick={() => setSort('newest')}
        data-testid="ops-sort-newest"
      >
        Newest
      </Button>
      <Button
        type="button"
        size="sm"
        variant={sort === 'oldest' ? 'default' : 'outline'}
        onClick={() => setSort('oldest')}
        data-testid="ops-sort-oldest"
      >
        Oldest
      </Button>
    </div>
  );
}

function ViewToggle({
  view,
  setView,
}: {
  view: OpsBoardView;
  setView: Dispatch<SetStateAction<OpsBoardView>>;
}) {
  return (
    <div className="hidden md:flex gap-1 shrink-0" data-testid="ops-board-view-toggle">
      <Button
        type="button"
        size="sm"
        variant={view === 'cards' ? 'default' : 'outline'}
        onClick={() => setView('cards')}
        data-testid="ops-view-cards"
      >
        Cards
      </Button>
      <Button
        type="button"
        size="sm"
        variant={view === 'table' ? 'default' : 'outline'}
        onClick={() => setView('table')}
        data-testid="ops-view-table"
      >
        Table
      </Button>
    </div>
  );
}

const FilterTrigger = forwardRef<
  HTMLButtonElement,
  { activeCount: number; open: boolean } & ComponentProps<typeof Button>
>(function FilterTrigger({ activeCount, open, className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      size="sm"
      variant={open || activeCount > 0 ? 'default' : 'outline'}
      className={cn('shrink-0', className)}
      data-testid="ops-filters-toggle"
      aria-expanded={open}
      {...props}
    >
      <ListFilter className="w-4 h-4" />
      Filter
      {activeCount > 0 && (
        <Badge
          variant="secondary"
          className="ml-0.5 min-w-5 justify-center px-1.5 tabular-nums"
          data-testid="ops-filters-count"
        >
          {activeCount}
        </Badge>
      )}
    </Button>
  );
});

function ActivePills({
  config,
  filters,
  setFilters,
  activeCount,
  onClear,
}: {
  config: OpsFilterConfig;
  filters: OpsBoardFilters;
  setFilters: Dispatch<SetStateAction<OpsBoardFilters>>;
  activeCount: number;
  onClear: () => void;
}) {
  const pills: { key: string; label: string; onRemove: () => void }[] = [];

  if (config.assignment && filters.assignment !== 'all') {
    pills.push({
      key: 'assignment',
      label: filters.assignment === 'assigned' ? 'Assigned' : 'Unassigned',
      onRemove: () => setFilters((f) => ({ ...f, assignment: 'all' })),
    });
  }
  if (config.stage && filters.stage !== 'all') {
    pills.push({
      key: 'stage',
      label: STAGE_PILL[filters.stage] ?? filters.stage,
      onRemove: () => setFilters((f) => ({ ...f, stage: 'all' })),
    });
  }
  if (config.dateRange && filters.dateRange !== 'all') {
    pills.push({
      key: 'date',
      label: datePillLabel(filters),
      onRemove: () =>
        setFilters((f) => ({ ...f, dateField: 'booking', dateRange: 'all' })),
    });
  }
  if (config.paymentMethod && filters.paymentMethod !== 'all') {
    pills.push({
      key: 'payment',
      label: paymentMethodLabel(filters.paymentMethod),
      onRemove: () => setFilters((f) => ({ ...f, paymentMethod: 'all' })),
    });
  }
  if (config.cod && filters.cod !== 'all') {
    pills.push({
      key: 'cod',
      label: 'COD',
      onRemove: () => setFilters((f) => ({ ...f, cod: 'all' })),
    });
  }

  if (pills.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="ops-active-filter-pills">
      {pills.map((pill) => (
        <Button
          key={pill.key}
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          onClick={pill.onRemove}
          data-testid={`ops-filter-pill-${pill.key}`}
        >
          {pill.label}
          <X className="w-3 h-3" aria-hidden />
          <span className="sr-only">Remove {pill.label}</span>
        </Button>
      ))}
      {activeCount >= 2 && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={onClear}
          data-testid="ops-filters-clear-all"
        >
          Clear all
        </Button>
      )}
    </div>
  );
}

export function OpsBoardFilterBar({
  config,
  filters,
  setFilters,
  sort,
  setSort,
  query,
  setQuery,
  activeCount,
  onClear,
  view,
  setView,
  onDownload,
  downloadDisabled,
  downloadBusy,
}: {
  config: OpsFilterConfig;
  filters: OpsBoardFilters;
  setFilters: Dispatch<SetStateAction<OpsBoardFilters>>;
  sort: OpsBoardSort;
  setSort: Dispatch<SetStateAction<OpsBoardSort>>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  activeCount: number;
  onClear: () => void;
  view?: OpsBoardView;
  setView?: Dispatch<SetStateAction<OpsBoardView>>;
  onDownload?: () => void;
  downloadDisabled?: boolean;
  downloadBusy?: boolean;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const panel = (
    <OpsFilterPanel
      config={config}
      filters={filters}
      setFilters={setFilters}
      onClear={onClear}
      onDone={() => setOpen(false)}
    />
  );

  return (
    <div className="mb-4 space-y-3" data-testid="ops-board-filter-bar">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search order no or consignee"
            className="h-11 pl-9 rounded-xl bg-white"
            data-testid="ops-section-search"
            aria-label="Search order no or consignee"
          />
        </div>
        {config.sort && <SortToggle sort={sort} setSort={setSort} />}
        {view != null && setView != null && (
          <ViewToggle view={view} setView={setView} />
        )}
        {onDownload != null && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={onDownload}
            disabled={downloadDisabled || downloadBusy}
            data-testid="ops-board-download"
          >
            {downloadBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Download
          </Button>
        )}
        {isMobile ? (
          <>
            <FilterTrigger
              activeCount={activeCount}
              open={open}
              onClick={() => setOpen(true)}
            />
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetContent
                side="bottom"
                className="rounded-t-2xl max-h-[85vh] overflow-y-auto"
              >
                <SheetHeader className="text-left mb-4">
                  <SheetTitle>Filters</SheetTitle>
                </SheetHeader>
                {panel}
              </SheetContent>
            </Sheet>
          </>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <FilterTrigger activeCount={activeCount} open={open} />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[22rem] p-4">
              {panel}
            </PopoverContent>
          </Popover>
        )}
      </div>

      <ActivePills
        config={config}
        filters={filters}
        setFilters={setFilters}
        activeCount={activeCount}
        onClear={onClear}
      />

      <p className="text-xs text-muted-foreground" data-testid="ops-board-window-caption">
        Among the latest 200 orders.
      </p>
    </div>
  );
}
