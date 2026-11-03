import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  DEFAULT_OPS_BOARD_FILTERS,
  DISPATCHED_FILTER_CONFIG,
  DROPOFFS_FILTER_CONFIG,
  PICKUPS_FILTER_CONFIG,
  PAYMENT_METHODS,
  applyOpsBoardQuery,
  coerceDateRange,
  countActiveFilters,
  dateRangesForField,
  type OpsAssignmentFilter,
  type OpsBoardFilters,
  type OpsBoardSort,
  type OpsDateField,
  type OpsDateRange,
  type OpsDateRangeOption,
  type OpsFilterConfig,
  type OpsPaymentMethodFilter,
  type OpsStageFilter,
} from '@shared/opsBoardQuery';
import type { OpsBoardOrder } from '@/hooks/useOpsOrders';

export type {
  OpsAssignmentFilter,
  OpsBoardFilters,
  OpsBoardSort,
  OpsDateField,
  OpsDateRange,
  OpsDateRangeOption,
  OpsFilterConfig,
  OpsPaymentMethodFilter,
  OpsStageFilter,
};

export {
  DEFAULT_OPS_BOARD_FILTERS,
  DISPATCHED_FILTER_CONFIG,
  DROPOFFS_FILTER_CONFIG,
  PICKUPS_FILTER_CONFIG,
  PAYMENT_METHODS,
  coerceDateRange,
  dateRangesForField,
};

export type OpsBoardFilterState = {
  visible: OpsBoardOrder[];
  filters: OpsBoardFilters;
  setFilters: Dispatch<SetStateAction<OpsBoardFilters>>;
  sort: OpsBoardSort;
  setSort: Dispatch<SetStateAction<OpsBoardSort>>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  activeCount: number;
  clear: () => void;
};

function filtersFromUrl(): OpsBoardFilters {
  if (typeof window === 'undefined') return DEFAULT_OPS_BOARD_FILTERS;
  const params = new URLSearchParams(window.location.search);
  const assignment = params.get('assignment');
  const stage = params.get('stage');
  return {
    ...DEFAULT_OPS_BOARD_FILTERS,
    ...(assignment === 'assigned' || assignment === 'unassigned' ? { assignment } : {}),
    ...(stage === 'inbound' || stage === 'hub' || stage === 'settled' ? { stage } : {}),
  };
}

export function useOpsBoardFilters(
  orders: OpsBoardOrder[],
  config: OpsFilterConfig,
): OpsBoardFilterState {
  // `?assignment=unassigned` and `?stage=hub` open the board pre-filtered, so
  // the dashboard can link straight to "pickups with no agent".
  const [filters, setFilters] = useState<OpsBoardFilters>(() => filtersFromUrl());
  const [sort, setSort] = useState<OpsBoardSort>('newest');
  const [query, setQuery] = useState('');

  const activeCount = useMemo(
    () => countActiveFilters(filters, config),
    [filters, config],
  );

  const visible = useMemo(
    () => applyOpsBoardQuery(orders, { filters, config, query, sort }),
    [orders, query, filters, config, sort],
  );

  const clear = useCallback(() => {
    setFilters(DEFAULT_OPS_BOARD_FILTERS);
    setQuery('');
  }, []);

  return {
    visible,
    filters,
    setFilters,
    sort,
    setSort,
    query,
    setQuery,
    activeCount,
    clear,
  };
}
