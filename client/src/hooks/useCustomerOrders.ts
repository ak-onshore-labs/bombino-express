/**
 * A6 — the customer's live view of their own orders.
 *
 * Everything a customer sees moves without them doing anything: an agent
 * accepts a pickup, ops receives the parcel at the hub, a docket is cut and an
 * AWB appears. Before this module those screens fetched once in a `useEffect`
 * and then sat there, so the only way to learn any of it had happened was to
 * reload the page. This is the polling half of A6.
 *
 * Three rules the whole file follows:
 *
 * 1. **Poll only what can still change.** Every hook stops once its subject is
 *    terminal — a dispatched or cancelled order, an AWB ITD has closed. A
 *    customer whose parcels have all arrived costs us nothing.
 * 2. **Poll only what is on screen.** `refetchIntervalInBackground` is left at
 *    its default of `false`, so a backgrounded tab stops entirely and picks up
 *    again on focus. Phones on mobile data are the common case here.
 * 3. **Override the global defaults explicitly.** `queryClient.ts` sets
 *    `staleTime: Infinity` and `refetchOnWindowFocus: false` — sensible for
 *    reference data, wrong for anything live. Each hook opts back out by hand
 *    rather than the defaults being loosened for everyone.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isTerminalOrderStatus } from '@shared/orderContract';
import type { CancellationState, OrderStatus } from '@shared/orderContract';
import { fetchMergedShipmentRows, type DisplayRow } from '@/lib/shipmentRows';
import { fetchOrderDetail, type OrderDetailResponse } from '@/lib/orderDetail';

/**
 * Cadences.
 *
 * The detail screen is faster than the list because it is the screen a customer
 * sits on while waiting for the agent they can see coming. The list is a glance
 * surface. Notifications are slowest — they are a digest, and the thing they
 * announce is already visible on the other two.
 */
const DETAIL_POLL_MS = 20_000;
const LIST_POLL_MS = 45_000;
const NOTIFICATION_POLL_MS = 90_000;
/**
 * Slower than the detail screen: a cancellation is decided by a person at a
 * desk, not by an agent moving through a slot, so the answer arrives in minutes
 * or hours rather than seconds.
 */
const CANCELLATION_POLL_MS = 60_000;

export const ORDER_HISTORY_KEY = ['customer', 'order-history'] as const;
export const NOTIFICATIONS_KEY = ['/api/notifications'] as const;

/** Matches the key OrderDetails already used, so existing invalidations hold. */
export function orderDetailKey(orderNo: string) {
  return ['/api/orders', orderNo] as const;
}

// ── The merged order + shipment list ──────────────────────────────────────

/**
 * Home and Orders both render this. One query key, so they share a cache and
 * navigating between them does not refetch.
 *
 * Polling stops when every row is terminal. It does not stop on an empty list:
 * a customer with no orders yet may be mid-booking in another tab, and the
 * first row appearing on its own is worth the request.
 */
export function useOrderHistory(enabled = true) {
  return useQuery<DisplayRow[]>({
    queryKey: ORDER_HISTORY_KEY,
    queryFn: fetchMergedShipmentRows,
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const rows = query.state.data;
      if (!rows) return LIST_POLL_MS;
      if (rows.length === 0) return LIST_POLL_MS;
      return rows.some((row) => row.isLive) ? LIST_POLL_MS : false;
    },
  });
}

// ── One order ─────────────────────────────────────────────────────────────

/**
 * The order detail screen.
 *
 * Stops polling at `dispatched` and `cancelled`. Dispatched is not the end of
 * the customer's interest, but it is the end of *this* record's — from there
 * the parcel is ITD's and the live surface is `/shipment/:awb`, which polls on
 * its own. Continuing here would be two screens asking about one parcel.
 */
export function useCustomerOrderDetail(orderNo: string) {
  return useQuery<OrderDetailResponse>({
    queryKey: orderDetailKey(orderNo),
    queryFn: () => fetchOrderDetail(orderNo),
    enabled: !!orderNo,
    staleTime: 0,
    retry: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const status = query.state.data?.order.status;
      if (!status) return DETAIL_POLL_MS;
      return isTerminalOrderStatus(status) ? false : DETAIL_POLL_MS;
    },
  });
}

// ── Cancellations ─────────────────────────────────────────────────────────

export interface CancellationRow {
  id: string;
  order_no: string;
  status: OrderStatus;
  /** Server-derived phrase, so this screen never invents its own vocabulary. */
  customerStatus: string;
  pickup_request: 1 | 2;
  pickup_date: string | null;
  quoted_amount: number | null;
  final_amount: number | null;
  payment_method: string;
  payment_status: string;
  created_at: string;
  updated_at: string;
  cancellation: {
    state: CancellationState;
    requestedAt: string | null;
    reason: string | null;
    decidedAt: string | null;
    decisionNote: string | null;
  };
}

export const CANCELLATIONS_KEY = ['/api/orders/cancellations'] as const;

/**
 * The cancellations screen.
 *
 * Polls while anything is still waiting on ops, and stops once every row has
 * been decided — a page of settled outcomes has nothing left to learn, and this
 * is a screen customers leave open while they wait for an answer.
 */
export function useCancellations(enabled = true) {
  return useQuery<CancellationRow[]>({
    queryKey: CANCELLATIONS_KEY,
    enabled,
    queryFn: async () => {
      const res = await fetch('/api/orders/cancellations', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Could not load your cancellations');
      }
      const data = (await res.json()) as { orders: CancellationRow[] };
      return data.orders;
    },
    staleTime: 0,
    retry: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const rows = query.state.data;
      if (!rows) return CANCELLATION_POLL_MS;
      return rows.some((r) => r.cancellation.state === 'pending')
        ? CANCELLATION_POLL_MS
        : false;
    },
  });
}

// ── Notifications ─────────────────────────────────────────────────────────

export interface CustomerNotification {
  id: string;
  user_id: string;
  type: string | null;
  title: string | null;
  body: string | null;
  data: { awb?: string } | null;
  is_read: boolean | null;
  read_at: string | null;
  shipment_id: string | null;
  created_at: string;
}

/**
 * Never throws on a bad response — an empty bell is a better failure than a
 * screen that will not render. The list beside it is the thing that matters,
 * and it reports its own errors.
 */
async function fetchNotifications(): Promise<CustomerNotification[]> {
  const res = await fetch('/api/notifications', {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const body: unknown = await res.json().catch(() => []);
  return Array.isArray(body) ? (body as CustomerNotification[]) : [];
}

export function useNotifications(enabled = true) {
  return useQuery<CustomerNotification[]>({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: fetchNotifications,
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: NOTIFICATION_POLL_MS,
  });
}

/**
 * The bell badge.
 *
 * Derived from the notification list rather than `/api/notifications/unread-count`,
 * which the two headers used to call once on mount and never again — so the
 * badge kept its number after the customer had read everything, and never grew
 * when something new arrived.
 *
 * Deriving it is exact, not an estimate: `listNotificationsByUserId` returns
 * every row for the user with no limit. It also means the badge and the list
 * cannot disagree, and that marking one read decrements the badge through the
 * same optimistic update, with no second request.
 */
export function useUnreadNotificationCount(enabled = true): number {
  const { data } = useNotifications(enabled);
  return (data ?? []).reduce((n, item) => (item.is_read ? n : n + 1), 0);
}

/**
 * Mark one notification read.
 *
 * Optimistic, unlike the agent's lifecycle actions — and for the opposite
 * reason. Nothing is contested here: it is the customer's own bell, the write
 * cannot be lost to someone else, and a dot that clears the instant it is
 * tapped is the whole point. On failure the previous list is restored and the
 * dot comes back, which is the honest outcome.
 */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string, { previous?: CustomerNotification[] }>({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Could not mark that as read');
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = queryClient.getQueryData<CustomerNotification[]>(NOTIFICATIONS_KEY);
      queryClient.setQueryData<CustomerNotification[]>(NOTIFICATIONS_KEY, (old) =>
        (old ?? []).map((n) =>
          n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n,
        ),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(NOTIFICATIONS_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
  });
}
