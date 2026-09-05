import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { OpsBoardOrder } from '@/hooks/useOpsOrders';

export type OpsCustomerListRow = {
  id: string;
  full_name: string;
  phone: string | null;
  account_type: 'personal' | 'company';
  created_at: string;
  kyc_on_file: boolean;
  order_count: number;
  doc_slots: string[];
  shipment_kyc: boolean;
  identity_kinds: string[];
};

export type OpsCustomerListFilters = {
  q: string;
  account_type?: 'personal' | 'company';
  kyc?: 'on_file' | 'none';
};

export type OpsShipmentKycMeta = {
  document_type: string;
  ocr_status: string | null;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  updated_at: string;
};

export type OpsIdentityMeta = {
  kind: 'aadhaar' | 'pan' | 'gstin';
  status: 'verified' | 'self_declared' | 'bypassed';
  verified_at: string;
};

export type OpsAccountDocMeta = {
  doc_slot: string;
  ocr_status: string | null;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  updated_at: string;
};

export type OpsCustomerDetail = {
  customer: {
    id: string;
    full_name: string;
    phone: string | null;
    account_type: 'personal' | 'company';
    company_name: string | null;
    company_category: string | null;
    gstin: string | null;
    created_at: string;
  };
  kyc: {
    on_file: boolean;
    shipment_kyc: OpsShipmentKycMeta | null;
    identity: OpsIdentityMeta[];
    documents: OpsAccountDocMeta[];
  };
};

export const OPS_CUSTOMERS_KEY = ['/api/ops/customers'] as const;

function opsCustomerDetailKey(id: string): readonly [string, string] {
  return ['/api/ops/customers', id] as const;
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export function useOpsCustomers(filters: OpsCustomerListFilters) {
  const trimmed = filters.q.trim();
  const accountType = filters.account_type;
  const kyc = filters.kyc;
  return useQuery({
    queryKey: [...OPS_CUSTOMERS_KEY, trimmed, accountType ?? '', kyc ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (trimmed) params.set('q', trimmed);
      if (accountType) params.set('account_type', accountType);
      if (kyc) params.set('kyc', kyc);
      const qs = params.toString();
      const res = await fetch(`/api/ops/customers${qs ? `?${qs}` : ''}`, {
        credentials: 'include',
      });
      const data = await readJson<{ customers: OpsCustomerListRow[] }>(res);
      return data.customers;
    },
    retry: false,
    refetchOnMount: 'always',
    placeholderData: keepPreviousData,
  });
}

export function useOpsCustomerDetail(id: string | undefined) {
  return useQuery({
    queryKey: id ? opsCustomerDetailKey(id) : ['/api/ops/customers', 'missing'],
    queryFn: async () => {
      if (!id) throw new Error('404: Customer not found');
      const res = await fetch(`/api/ops/customers/${encodeURIComponent(id)}`, {
        credentials: 'include',
      });
      return readJson<OpsCustomerDetail>(res);
    },
    enabled: Boolean(id),
    retry: false,
    refetchOnMount: 'always',
  });
}

export function useOpsCustomerOrders(id: string | undefined) {
  return useQuery({
    queryKey: id ? [...opsCustomerDetailKey(id), 'orders'] : ['/api/ops/customers', 'missing', 'orders'],
    queryFn: async () => {
      if (!id) throw new Error('404: Customer not found');
      const res = await fetch(`/api/ops/customers/${encodeURIComponent(id)}/orders`, {
        credentials: 'include',
      });
      const data = await readJson<{ orders: OpsBoardOrder[] }>(res);
      return data.orders;
    },
    enabled: Boolean(id),
    retry: false,
    refetchOnMount: 'always',
  });
}

export type OpsIdentityReveal = {
  kind: 'aadhaar' | 'pan' | 'gstin';
  document_no: string;
  status: 'verified' | 'self_declared' | 'bypassed';
};

async function readOk(res: Response): Promise<Response> {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return res;
}

/** One logged GET — do not cache the blob. */
export async function fetchOpsCustomerKycFile(customerId: string): Promise<Blob> {
  const res = await fetch(`/api/ops/customers/${encodeURIComponent(customerId)}/kyc/file`, {
    credentials: 'include',
    cache: 'no-store',
  });
  await readOk(res);
  return res.blob();
}

/** One logged GET — do not cache the blob. */
export async function fetchOpsCustomerDocumentFile(
  customerId: string,
  slot: string,
): Promise<Blob> {
  const res = await fetch(
    `/api/ops/customers/${encodeURIComponent(customerId)}/documents/${encodeURIComponent(slot)}/file`,
    { credentials: 'include', cache: 'no-store' },
  );
  await readOk(res);
  return res.blob();
}

/** One logged GET — do not put this in React Query. */
export async function fetchOpsCustomerIdentityNumber(
  customerId: string,
  kind: OpsIdentityMeta['kind'],
): Promise<OpsIdentityReveal> {
  const res = await fetch(
    `/api/ops/customers/${encodeURIComponent(customerId)}/identity/${encodeURIComponent(kind)}`,
    { credentials: 'include', cache: 'no-store' },
  );
  return readJson<OpsIdentityReveal>(res);
}
