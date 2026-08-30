/**
 * Ops board query — single source of truth for section gates, stage→status
 * sets, filter matching, IST date windows, and sort. Imported by the client
 * board hooks/pages and the server orders-export path so the CSV cannot drift
 * from what the board shows.
 *
 * Pure types + functions only — no React, no DB, no network.
 */

import type { OrderStatus, PaymentMethod } from './orderContract';
import { nowInIst, startOfIstDayIso } from './pickupSlots';

// ── Sections ──────────────────────────────────────────────────────────────

export type OpsBoardSection = 'pickups' | 'dropoffs' | 'dispatched';

export type OpsBoardOrderLike = {
  status: string;
  created_at: string;
  pickup_request: number;
  pickup_date: string | null;
  payment_method: string;
  is_cod: boolean;
  agent_id: string | null;
  order_no: string;
  consignee_name: string | null;
  consignee_city: string | null;
  awb_no: string | null;
};

export function matchesOpsSection(
  order: OpsBoardOrderLike,
  section: OpsBoardSection,
): boolean {
  if (section === 'pickups') {
    return (
      order.pickup_request === 1 &&
      order.status !== 'dispatched' &&
      order.status !== 'cancelled'
    );
  }
  if (section === 'dropoffs') {
    return (
      order.pickup_request === 2 &&
      order.status !== 'dispatched' &&
      order.status !== 'cancelled'
    );
  }
  return order.status === 'dispatched';
}

// ── Stages / phases ───────────────────────────────────────────────────────

export type OpsPhaseId =
  | 'inbound'
  | 'hub'
  | 'settled'
  | 'dispatched'
  | 'cancelled';

export type OpsStageFilter = 'all' | 'inbound' | 'hub' | 'settled';

/** Status sets shared by board grouping and the stage filter. */
export const OPS_PHASE_STATUSES: Record<OpsPhaseId, readonly OrderStatus[]> = {
  inbound: [
    'pickup_requested',
    'agent_accepted',
    'out_for_pickup',
    'picked_up',
    'awaiting_dropoff',
  ],
  hub: ['received_at_hub', 'weighed'],
  settled: ['settled', 'ready_for_docket'],
  dispatched: ['dispatched'],
  cancelled: ['cancelled'],
};

const STATUS_TO_PHASE = new Map<string, OpsPhaseId>();
for (const [phaseId, statuses] of Object.entries(OPS_PHASE_STATUSES) as [
  OpsPhaseId,
  readonly OrderStatus[],
][]) {
  for (const status of statuses) {
    STATUS_TO_PHASE.set(status, phaseId);
  }
}

export function phaseIdForStatus(status: string): OpsPhaseId {
  return STATUS_TO_PHASE.get(status) ?? 'inbound';
}

/** Statuses that belong to a stage filter value (inbound / hub / settled). */
export function statusesForStage(stage: Exclude<OpsStageFilter, 'all'>): readonly OrderStatus[] {
  return OPS_PHASE_STATUSES[stage];
}

// ── Filter config per section ─────────────────────────────────────────────

export type OpsFilterConfig = {
  assignment?: boolean;
  stage?: boolean;
  dateRange?: boolean;
  pickupDate?: boolean;
  paymentMethod?: boolean;
  sort?: boolean;
};

export const PICKUPS_FILTER_CONFIG: OpsFilterConfig = {
  assignment: true,
  stage: true,
  dateRange: true,
  pickupDate: true,
  paymentMethod: true,
  sort: true,
};

export const DROPOFFS_FILTER_CONFIG: OpsFilterConfig = {
  assignment: false,
  stage: true,
  dateRange: true,
  pickupDate: false,
  paymentMethod: true,
  sort: true,
};

export const DISPATCHED_FILTER_CONFIG: OpsFilterConfig = {
  assignment: false,
  stage: false,
  dateRange: true,
  pickupDate: true,
  paymentMethod: true,
  sort: true,
};

export function filterConfigForSection(section: OpsBoardSection): OpsFilterConfig {
  if (section === 'pickups') return PICKUPS_FILTER_CONFIG;
  if (section === 'dropoffs') return DROPOFFS_FILTER_CONFIG;
  return DISPATCHED_FILTER_CONFIG;
}

// ── Filter / sort types ───────────────────────────────────────────────────

export type OpsAssignmentFilter = 'all' | 'assigned' | 'unassigned';
export type OpsDateField = 'booking' | 'pickup';
export type OpsDateRange = 'all' | 'today' | '7d' | '30d' | 'tomorrow' | 'week';
export type OpsPaymentMethodFilter = 'all' | PaymentMethod;
export type OpsBoardSort = 'newest' | 'oldest';

export type OpsBoardFilters = {
  assignment: OpsAssignmentFilter;
  stage: OpsStageFilter;
  dateField: OpsDateField;
  dateRange: OpsDateRange;
  paymentMethod: OpsPaymentMethodFilter;
};

export const DEFAULT_OPS_BOARD_FILTERS: OpsBoardFilters = {
  assignment: 'all',
  stage: 'all',
  dateField: 'booking',
  dateRange: 'all',
  paymentMethod: 'all',
};

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'pay_now',
  'pay_at_pickup',
  'pay_at_dropoff',
  'cod',
];

export type OpsDateRangeOption = { value: OpsDateRange; label: string };

const BOOKING_DATE_RANGES: readonly OpsDateRangeOption[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

const PICKUP_DATE_RANGES: readonly OpsDateRangeOption[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'week', label: 'Next 7 days' },
];

export function dateRangesForField(field: OpsDateField): readonly OpsDateRangeOption[] {
  return field === 'pickup' ? PICKUP_DATE_RANGES : BOOKING_DATE_RANGES;
}

export function coerceDateRange(field: OpsDateField, range: OpsDateRange): OpsDateRange {
  return dateRangesForField(field).some((option) => option.value === range) ? range : 'all';
}

export function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function bookingCutoffYmd(range: OpsDateRange): string | null {
  if (range === 'all' || range === 'tomorrow' || range === 'week') return null;
  const today = nowInIst().date;
  if (range === 'today') return today;
  if (range === '7d') return addCalendarDays(today, -6);
  return addCalendarDays(today, -29);
}

export function matchesSearch(order: OpsBoardOrderLike, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const hay = [order.order_no, order.consignee_name, order.consignee_city, order.awb_no]
    .filter((v): v is string => Boolean(v))
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

export function isCodOrder(order: OpsBoardOrderLike): boolean {
  return order.is_cod || order.payment_method === 'cod';
}

function matchesDate(
  order: OpsBoardOrderLike,
  filters: OpsBoardFilters,
  config: OpsFilterConfig,
): boolean {
  if (filters.dateRange === 'all') return true;

  const field = config.pickupDate === false ? 'booking' : filters.dateField;
  const range = coerceDateRange(field, filters.dateRange);
  if (range === 'all') return true;

  if (field === 'pickup') {
    if (!order.pickup_date) return false;
    const today = nowInIst().date;
    if (range === 'today') return order.pickup_date === today;
    if (range === 'tomorrow') return order.pickup_date === addCalendarDays(today, 1);
    if (range === 'week') {
      const end = addCalendarDays(today, 6);
      return order.pickup_date >= today && order.pickup_date <= end;
    }
    return true;
  }

  const cutoff = bookingCutoffYmd(range);
  if (!cutoff) return true;
  const created = Date.parse(order.created_at);
  const start = Date.parse(startOfIstDayIso(cutoff));
  if (!Number.isFinite(created) || !Number.isFinite(start)) return false;
  return created >= start;
}

export function matchesFilters(
  order: OpsBoardOrderLike,
  filters: OpsBoardFilters,
  config: OpsFilterConfig,
): boolean {
  if (config.assignment && filters.assignment !== 'all') {
    const assigned = Boolean(order.agent_id);
    if (filters.assignment === 'assigned' && !assigned) return false;
    if (filters.assignment === 'unassigned' && assigned) return false;
  }

  if (config.stage && filters.stage !== 'all') {
    if (phaseIdForStatus(order.status) !== filters.stage) return false;
  }

  if (config.dateRange && !matchesDate(order, filters, config)) return false;

  if (config.paymentMethod && filters.paymentMethod !== 'all') {
    // COD is a payment choice, but is_cod-flagged rows may not have method==='cod'.
    if (filters.paymentMethod === 'cod') {
      if (!isCodOrder(order)) return false;
    } else if (order.payment_method !== filters.paymentMethod) {
      return false;
    }
  }

  return true;
}

export function countActiveFilters(
  filters: OpsBoardFilters,
  config: OpsFilterConfig,
): number {
  let n = 0;
  if (config.assignment && filters.assignment !== 'all') n += 1;
  if (config.stage && filters.stage !== 'all') n += 1;
  if (config.dateRange && filters.dateRange !== 'all') n += 1;
  if (config.paymentMethod && filters.paymentMethod !== 'all') n += 1;
  return n;
}

export function sortOpsBoardOrders<T extends OpsBoardOrderLike>(
  orders: T[],
  sort: OpsBoardSort,
): T[] {
  return [...orders].sort((a, b) => {
    const da = new Date(a.created_at).getTime();
    const db = new Date(b.created_at).getTime();
    const aTime = Number.isFinite(da) ? da : 0;
    const bTime = Number.isFinite(db) ? db : 0;
    return sort === 'oldest' ? aTime - bTime : bTime - aTime;
  });
}

/**
 * Apply search + filters + sort (section already applied by the caller —
 * board pages filter first; export applies section in SQL then this in JS).
 */
export function applyOpsBoardQuery<T extends OpsBoardOrderLike>(
  orders: T[],
  opts: {
    filters: OpsBoardFilters;
    config: OpsFilterConfig;
    query: string;
    sort: OpsBoardSort;
  },
): T[] {
  const filtered = orders.filter(
    (order) =>
      matchesSearch(order, opts.query) &&
      matchesFilters(order, opts.filters, opts.config),
  );
  return sortOpsBoardOrders(filtered, opts.sort);
}
