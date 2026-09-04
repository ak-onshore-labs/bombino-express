import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AvailableAction } from '@shared/orderContract';
import type {
  OpsBoardFilters,
  OpsBoardSection,
  OpsBoardSort,
} from '@shared/opsBoardQuery';
import { apiRequest } from '@/lib/queryClient';
import { parseApiErrorMessage } from '@/lib/apiError';

export type OpsBoardOrder = {
  id: string;
  order_no: string;
  user_id: string | null;
  customer_name: string | null;
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
  agent_id: string | null;
  agent_name: string | null;
  awb_no: string | null;
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
  role: string;
  is_active: boolean;
};

export function opsOrderDetailKey(id: string) {
  return ['/api/ops/orders', id] as const;
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export function useOpsOrders() {
  return useQuery({
    queryKey: OPS_ORDERS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/ops/orders', { credentials: 'include' });
      const data = await readJson<{ orders: OpsBoardOrder[] }>(res);
      return data.orders;
    },
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

export function useOpsPayments(range: OpsPaymentRange) {
  return useQuery({
    queryKey: [...OPS_PAYMENTS_KEY, range],
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

export function useOpsCancellations() {
  return useQuery({
    queryKey: OPS_CANCELLATIONS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/ops/cancellations', { credentials: 'include' });
      return readJson<{ cancellations: OpsPendingCancellation[]; count: number }>(res);
    },
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
