/**
 * Parcels coming TO the signed-in number — the receiver's side of the Orders
 * screen. Same polling rules as the sender's list (useCustomerOrders.ts): only
 * while something can still move, only while on screen.
 */

import { useQuery } from '@tanstack/react-query';
import { isTerminalOrderStatus } from '@shared/orderContract';
import type { ReceivingDetail, ReceivingParcel } from '@shared/receiving';

const LIST_POLL_MS = 45_000;
const DETAIL_POLL_MS = 30_000;

export const RECEIVING_KEY = ['/api/receiving'] as const;

export function receivingDetailKey(orderNo: string) {
  return ['/api/receiving', orderNo] as const;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message
        : res.statusText;
    throw new Error(`${res.status}: ${message}`);
  }
  return body as T;
}

/** The incoming list. Empty for anyone who has not proved a number. */
export function useReceiving(enabled = true) {
  return useQuery<ReceivingParcel[]>({
    queryKey: RECEIVING_KEY,
    queryFn: async () => {
      const res = await fetch('/api/receiving', { credentials: 'include' });
      // Signed out, or a session with no verified number: nothing is coming to it.
      if (res.status === 401) return [];
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      const body = (await res.json()) as { parcels?: ReceivingParcel[] };
      return body.parcels ?? [];
    },
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const rows = query.state.data;
      if (!rows || rows.length === 0) return LIST_POLL_MS;
      return rows.some((p) => !isTerminalOrderStatus(p.status)) ? LIST_POLL_MS : false;
    },
  });
}

/** One incoming parcel. Stops polling once it has left our hands. */
export function useReceivingDetail(orderNo: string) {
  return useQuery<ReceivingDetail>({
    queryKey: receivingDetailKey(orderNo),
    queryFn: () => getJson<ReceivingDetail>(`/api/receiving/${encodeURIComponent(orderNo)}`),
    enabled: !!orderNo,
    staleTime: 0,
    retry: false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const status = query.state.data?.parcel.status;
      return status && isTerminalOrderStatus(status) ? false : DETAIL_POLL_MS;
    },
  });
}
