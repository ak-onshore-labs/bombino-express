import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AvailableAction } from '@shared/orderContract';
import type {
  OpsBoardFilters,
  OpsBoardSection,
  OpsBoardSort,
} from '@shared/opsBoardQuery';
import { apiRequest, readJson } from '@/lib/queryClient';
import { parseApiErrorMessage } from '@/lib/apiError';

export type OpsBoardOrder = {
  id: string;
  order_no: string;
  user_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  guest_ref: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  status: string;
  created_at: string;
  pickup_request: number;
  pickup_date: string | null;
  payment_method: string;
  payment_status: string;
  is_cod: boolean;
  quoted_amount: number | null;
  final_amount: number | null;
  consignee_name: string | null;
  consignee_city: string | null;
  /** Pickup locality (address line 2, else city), from the origin address. */
  pickup_area?: string | null;
  pickup_pincode?: string | null;
  agent_id: string | null;
  agent_name: string | null;
  awb_no: string | null;
  /**
   * Why this order has no AWB when one was expected at booking. Null on every
   * ordinary order, including every guest and local-account order — those are
   * never docketed at booking and are simply waiting their turn with ops.
   */
  docket_error: string | null;
  /** What usually causes that refusal and what to do. */
  docket_error_hint?: string | null;
  /** What the pre-check found missing, for ops to fix. */
  docket_error_problems?: string[];
  /** Who acts next: "auto" (retrying by itself), "ops", or "check_itd". */
  docket_retry?: string | null;
  /**
   * An agent cancelled this pickup. On board rows only while the branch still
   * has to act; on the order page always, with `open` saying which.
   */
  agent_cancellation?: OpsAgentCancellation | null;
  /** Booked on a test number: a test AWB, never filed with ITD. */
  is_test?: boolean;
};

export type OpsAgentCancellation = {
  at: string;
  /** The order's status when the agent cancelled. */
  from_status: string;
  open: boolean;
  agent_id: string;
  agent_name: string | null;
  agent_phone: string | null;
};

export type OpsOrderEvent = {
  id: string;
  status: string;
  note: string | null;
  actor_user_id: string | null;
  metadata: unknown;
  created_at: string;
};

export type OpsOrderDetail = OpsBoardOrder & {
  origin_address_id: string | null;
  /** Full pickup address on one line. */
  pickup_address?: string | null;
  /** The assigned agent's phone number. */
  agent_phone?: string | null;
  packaging_required?: boolean;
  consignee: unknown;
  items: unknown;
  booked_weight: number | null;
  actual_weight: number | null;
  itd_docket_response: unknown;
  metadata: unknown;
  updated_at: string;
};

export type OpsHubHandover = {
  kind: 'hub';
  code: string | null;
  locked: boolean;
};

export type OpsOrderDetailResponse = {
  order: OpsOrderDetail;
  events: OpsOrderEvent[];
  availableActions: AvailableAction[];
  handover: OpsHubHandover | null;
  /**
   * The customer has an ITD login of their own: their AWB is a real filing
   * (Generate docket / Retry AWB). Otherwise ops files it in ITD's portal and
   * enters it (Enter AWB from ITD portal).
   */
  owner_has_itd_login?: boolean;
  /** This account may mark the order test or real (server/testOrders.ts). */
  can_mark_test?: boolean;
};

export type OpsActionResult = {
  order: OpsOrderDetail;
  availableActions: AvailableAction[];
  receipt?: { txnId: string | null; amount: number };
  warning?: string;
};

export type OpsActionError = Error & {
  status?: number;
  code?: string;
};

export const OPS_ORDERS_KEY = ['/api/ops/orders'] as const;
export const OPS_ORDERS_EXPORT_KEY = ['/api/ops/orders/export'] as const;
export const OPS_USERS_KEY = ['/api/ops/users'] as const;
export const OPS_PAYMENTS_KEY = ['/api/ops/payments'] as const;
export const OPS_CANCELLATIONS_KEY = ['/api/ops/cancellations'] as const;
export const OPS_VERIFICATIONS_KEY = ['/api/ops/verifications'] as const;

/** A customer account that still owes documents. */
export interface OpsVerificationRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  account_type: string;
  company_name: string | null;
  company_category: string | null;
  created_at: string | null;
  /** Required slots with nothing uploaded. */
  missing: string[];
  /** Uploaded, but OCR never confirmed them. */
  unverified: string[];
}

export type OpsPaymentRange = 'today' | '7d';

export type OpsPaymentRow = {
  id: string;
  txn_id: string | null;
  order_id: string;
  order_no: string | null;
  amount: number;
  currency: string;
  method: string;
  collection_mode: 'cash' | 'upi' | null;
  collected_by: string | null;
  collector_name: string;
  collected_at: string | null;
  status: string;
  reference: string | null;
};

export type OpsPaymentTotals = {
  all: number;
  cash: number;
  upi: number;
  gateway: number;
  count: number;
};

export type OpsPendingCancellation = {
  id: string;
  order_no: string;
  consignee_name: string | null;
  requested_at: string;
  reason: string | null;
};

export type OpsStaffUser = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
};

export function opsOrderDetailKey(id: string) {
  return ['/api/ops/orders', id] as const;
}

/** The latest 200 orders — the boards' list, and what the nav's pills count. */
export async function fetchOpsOrders(): Promise<OpsBoardOrder[]> {
  const res = await fetch('/api/ops/orders', { credentials: 'include' });
  const data = await readJson<{ orders: OpsBoardOrder[] }>(res);
  return data.orders;
}

export function useOpsOrders(enabled = true) {
  return useQuery({
    queryKey: OPS_ORDERS_KEY,
    queryFn: fetchOpsOrders,
    enabled,
    retry: false,
    refetchOnMount: 'always',
  });
}

export function useOpsOrderDetail(orderId: string | undefined) {
  return useQuery({
    queryKey: opsOrderDetailKey(orderId ?? ''),
    enabled: !!orderId,
    queryFn: async () => {
      const res = await fetch(`/api/ops/orders/${encodeURIComponent(orderId!)}`, {
        credentials: 'include',
      });
      return readJson<OpsOrderDetailResponse>(res);
    },
    retry: false,
  });
}

export const OPS_TEST_ACCESS_KEY = ['/api/ops/test-access'] as const;

export type OpsTestAccess = {
  /** Signed in on a test number: gets the test/live data switch. */
  test_staff: boolean;
  /** On test data now (test records only); false = live records only. */
  sees_test: boolean;
  can_mark: boolean;
};

/** Whether this account is on test data, and may mark orders test or real. */
export function useOpsTestAccess() {
  return useQuery({
    queryKey: OPS_TEST_ACCESS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/ops/test-access', { credentials: 'include' });
      return readJson<OpsTestAccess>(res);
    },
    retry: false,
    staleTime: Infinity,
  });
}

/**
 * Switch a test number's console between test data and live data
 * (PUT /api/ops/data-mode). Every ops list changes, so everything refetches.
 */
export function useOpsSetDataMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mode: 'test' | 'live') => {
      const res = await apiRequest('PUT', '/api/ops/data-mode', { mode });
      return (await res.json()) as { mode: 'test' | 'live' };
    },
    onSuccess: ({ mode }) => {
      queryClient.setQueryData<OpsTestAccess>(OPS_TEST_ACCESS_KEY, (prev) =>
        prev ? { ...prev, sees_test: mode === 'test' } : prev
      );
      void queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== OPS_TEST_ACCESS_KEY[0],
      });
    },
  });
}

/** Mark an order test or real (PUT /api/ops/orders/:id/test). */
export function useOpsSetTestMark(orderId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (test: boolean) => {
      if (!orderId) throw new Error('Missing order id');
      const res = await apiRequest('PUT', `/api/ops/orders/${orderId}/test`, { test });
      return (await res.json()) as { test: boolean; removed_awb: string | null };
    },
    onSettled: () => {
      if (!orderId) return;
      void queryClient.invalidateQueries({ queryKey: opsOrderDetailKey(orderId) });
      void queryClient.invalidateQueries({ queryKey: OPS_ORDERS_KEY });
      void queryClient.invalidateQueries({ queryKey: OPS_ORDERS_EXPORT_KEY });
    },
  });
}

export function useOpsOrderAction(orderId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<
    OpsActionResult,
    OpsActionError,
    { action: string; payload?: Record<string, unknown> }
  >({
    mutationFn: async ({ action, payload }) => {
      if (!orderId) throw new Error('Missing order id') as OpsActionError;
      try {
        const res = await apiRequest('POST', `/api/orders/${orderId}/actions`, {
          action,
          ...(payload ? { payload } : {}),
        });
        return (await res.json()) as OpsActionResult;
      } catch (err) {
        const error = new Error(
          parseApiErrorMessage(err, 'Could not complete that action'),
        ) as OpsActionError;
        const raw = String((err as Error)?.message ?? '');
        const status = Number(raw.split(':')[0]);
        error.status = Number.isFinite(status) ? status : 0;
        try {
          const body = JSON.parse(raw.replace(/^\d+:\s*/, '')) as {
            code?: string;
            message?: string;
          };
          error.code = body.code;
          if (body.message) error.message = body.message;
        } catch {
          error.code = undefined;
        }
        throw error;
      }
    },
    onSettled: (_data, _err, _vars) => {
      if (!orderId) return;
      void queryClient.invalidateQueries({ queryKey: opsOrderDetailKey(orderId) });
      void queryClient.invalidateQueries({ queryKey: OPS_ORDERS_KEY });
      void queryClient.invalidateQueries({ queryKey: OPS_ORDERS_EXPORT_KEY });
    },
  });
}

export function useOpsStaffUsers() {
  return useQuery({
    queryKey: OPS_USERS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/ops/users', { credentials: 'include' });
      const data = await readJson<{ users: OpsStaffUser[] }>(res);
      return data.users;
    },
    retry: false,
    refetchOnMount: 'always',
  });
}

export function useOpsPayments(range: OpsPaymentRange, enabled = true) {
  return useQuery({
    queryKey: [...OPS_PAYMENTS_KEY, range],
    enabled,
    queryFn: async () => {
      const res = await fetch(`/api/ops/payments?range=${encodeURIComponent(range)}`, {
        credentials: 'include',
      });
      return readJson<{ payments: OpsPaymentRow[]; totals: OpsPaymentTotals }>(res);
    },
    retry: false,
    refetchOnMount: 'always',
  });
}

/** One-shot uncapped payments for CSV (does not touch the capped ledger cache). */
export async function fetchOpsPaymentsExport(
  range: OpsPaymentRange,
): Promise<OpsPaymentRow[]> {
  const res = await fetch(
    `/api/ops/payments/export?range=${encodeURIComponent(range)}`,
    { credentials: 'include' },
  );
  const data = await readJson<{ payments: OpsPaymentRow[] }>(res);
  return data.payments;
}

export type OpsOrdersExportQuery = {
  section: 'pickups' | 'dropoffs' | 'dispatched';
  assignment?: string;
  stage?: string;
  dateField?: string;
  dateRange?: string;
  paymentMethod?: string;
  q?: string;
  sort?: string;
};

/** One-shot uncapped orders for CSV (does not touch the capped board cache). */
export async function fetchOpsOrdersExport(
  params: OpsOrdersExportQuery,
): Promise<OpsBoardOrder[]> {
  const qs = new URLSearchParams();
  qs.set('section', params.section);
  if (params.assignment) qs.set('assignment', params.assignment);
  if (params.stage) qs.set('stage', params.stage);
  if (params.dateField) qs.set('dateField', params.dateField);
  if (params.dateRange) qs.set('dateRange', params.dateRange);
  if (params.paymentMethod) qs.set('paymentMethod', params.paymentMethod);
  if (params.q) qs.set('q', params.q);
  if (params.sort) qs.set('sort', params.sort);
  const res = await fetch(`/api/ops/orders/export?${qs.toString()}`, {
    credentials: 'include',
  });
  const data = await readJson<{ orders: OpsBoardOrder[] }>(res);
  return data.orders;
}

/**
 * Uncapped filtered board list — same GET /api/ops/orders/export as CSV.
 * Enabled only when filters/search are active; does not touch OPS_ORDERS_KEY.
 */
export function useOpsBoardFiltered(opts: {
  section: OpsBoardSection;
  filters: OpsBoardFilters;
  sort: OpsBoardSort;
  query: string;
  enabled: boolean;
}) {
  const { section, filters, sort, query, enabled } = opts;
  return useQuery({
    queryKey: [...OPS_ORDERS_EXPORT_KEY, section, filters, sort, query],
    queryFn: () =>
      fetchOpsOrdersExport({
        section,
        assignment: filters.assignment,
        stage: filters.stage,
        dateField: filters.dateField,
        dateRange: filters.dateRange,
        paymentMethod: filters.paymentMethod,
        q: query || undefined,
        sort,
      }),
    enabled,
    retry: false,
    refetchOnMount: 'always',
    placeholderData: keepPreviousData,
  });
}

export function useOpsCancellations(enabled = true) {
  return useQuery({
    queryKey: OPS_CANCELLATIONS_KEY,
    enabled,
    queryFn: async () => {
      const res = await fetch('/api/ops/cancellations', { credentials: 'include' });
      return readJson<{ cancellations: OpsPendingCancellation[]; count: number }>(res);
    },
    retry: false,
    refetchOnMount: 'always',
  });
}

/**
 * Customers whose documents are outstanding.
 *
 * The only user-shaped query in ops. A document can be rejected or fall out of
 * date after the account is open, and the customer is told to contact the
 * Bombino team — which needs someone at Bombino able to see who is waiting.
 */
export function useOpsVerifications(enabled = true) {
  return useQuery({
    queryKey: OPS_VERIFICATIONS_KEY,
    enabled,
    queryFn: async () => {
      const res = await fetch('/api/ops/verifications', { credentials: 'include' });
      return readJson<{ accounts: OpsVerificationRow[]; count: number }>(res);
    },
    retry: false,
    refetchOnMount: 'always',
  });
}

export interface OpsAssignableAgents {
  /** The pickup's city, or null when it can't be told. */
  city: string | null;
  /** False when the list is every active agent rather than the city's. */
  scoped: boolean;
  agents: { id: string; full_name: string; phone: string | null }[];
}

/** The agents in this pickup's city, for the Assign to agent picker. */
export function useOpsAssignableAgents(orderId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['/api/ops/orders', orderId, 'assignable-agents'] as const,
    queryFn: async () => {
      const res = await fetch(`/api/ops/orders/${orderId}/assignable-agents`, {
        credentials: 'include',
      });
      return readJson<OpsAssignableAgents>(res);
    },
    enabled: !!orderId && enabled,
    retry: false,
    refetchOnMount: 'always',
  });
}

export function useOpsAssign(orderId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<{ order: OpsOrderDetail }, OpsActionError, { agentId: string }>({
    mutationFn: async ({ agentId }) => {
      if (!orderId) throw new Error('Missing order id') as OpsActionError;
      try {
        const res = await apiRequest('POST', `/api/ops/orders/${orderId}/assign`, {
          agent_id: agentId,
        });
        return (await res.json()) as { order: OpsOrderDetail };
      } catch (err) {
        const error = new Error(
          parseApiErrorMessage(err, 'Could not assign this pickup'),
        ) as OpsActionError;
        const raw = String((err as Error)?.message ?? '');
        const status = Number(raw.split(':')[0]);
        error.status = Number.isFinite(status) ? status : 0;
        try {
          const body = JSON.parse(raw.replace(/^\d+:\s*/, '')) as {
            code?: string;
            message?: string;
          };
          error.code = body.code;
          if (body.message) error.message = body.message;
        } catch {
          error.code = undefined;
        }
        throw error;
      }
    },
    onSettled: () => {
      if (!orderId) return;
      void queryClient.invalidateQueries({ queryKey: opsOrderDetailKey(orderId) });
      void queryClient.invalidateQueries({ queryKey: OPS_ORDERS_KEY });
      void queryClient.invalidateQueries({ queryKey: OPS_ORDERS_EXPORT_KEY });
    },
  });
}
