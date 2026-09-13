import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { OpsBoardOrder } from '@/hooks/useOpsOrders';

export type OpsGuestAccountType = 'personal' | 'company' | null;

export type OpsGuestListRow = {
  guest_ref: string;
  full_name: string | null;
  phone: string;
  email: string | null;
  account_type: OpsGuestAccountType;
  created_at: string;
  kyc_on_file: boolean;
  order_count: number;
};

export type OpsGuestListFilters = {
  q: string;
  account_type?: 'personal' | 'company' | 'unset';
};

export type OpsShipmentKycMeta = {
  document_type: string;
  ocr_status: string | null;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  updated_at: string;
};

export type OpsGuestDetail = {
  guest: {
    guest_ref: string;
    full_name: string | null;
    phone: string;
    email: string | null;
    account_type: OpsGuestAccountType;
    company_category: string | null;
    company_name: string | null;
    gstin: string | null;
    gstin_verified_name: string | null;
    contact_person: string | null;
    address_line_1: string | null;
    pincode: string | null;
    city: string | null;
    state: string | null;
    hub_id: string | null;
    extras: Record<string, string> | null;
    created_at: string;
  };
  kyc: {
    on_file: boolean;
    shipment_kyc: OpsShipmentKycMeta | null;
  };
};

export const OPS_GUESTS_KEY = ['/api/ops/guests'] as const;

function opsGuestDetailKey(ref: string): readonly [string, string] {
  return ['/api/ops/guests', ref] as const;
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export function useOpsGuests(filters: OpsGuestListFilters) {
  const trimmed = filters.q.trim();
  const accountType = filters.account_type;
  return useQuery({
    queryKey: [...OPS_GUESTS_KEY, trimmed, accountType ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (trimmed) params.set('q', trimmed);
      if (accountType) params.set('account_type', accountType);
      const qs = params.toString();
      const res = await fetch(`/api/ops/guests${qs ? `?${qs}` : ''}`, {
        credentials: 'include',
      });
      const data = await readJson<{ guests: OpsGuestListRow[] }>(res);
      return data.guests;
    },
    retry: false,
    refetchOnMount: 'always',
    placeholderData: keepPreviousData,
  });
}

export function useOpsGuestDetail(ref: string | undefined) {
  return useQuery({
    queryKey: ref ? opsGuestDetailKey(ref) : ['/api/ops/guests', 'missing'],
    queryFn: async () => {
      if (!ref) throw new Error('404: Guest not found');
      const res = await fetch(`/api/ops/guests/${encodeURIComponent(ref)}`, {
        credentials: 'include',
      });
      return readJson<OpsGuestDetail>(res);
    },
    enabled: Boolean(ref),
    retry: false,
    refetchOnMount: 'always',
  });
}

export function useOpsGuestOrders(ref: string | undefined) {
  return useQuery({
    queryKey: ref ? [...opsGuestDetailKey(ref), 'orders'] : ['/api/ops/guests', 'missing', 'orders'],
    queryFn: async () => {
      if (!ref) throw new Error('404: Guest not found');
      const res = await fetch(`/api/ops/guests/${encodeURIComponent(ref)}/orders`, {
        credentials: 'include',
      });
      const data = await readJson<{ orders: OpsBoardOrder[] }>(res);
      return data.orders;
    },
    enabled: Boolean(ref),
    retry: false,
    refetchOnMount: 'always',
  });
}
