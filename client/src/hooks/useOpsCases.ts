import { useQuery } from '@tanstack/react-query';

/** The ops console's Cases tab (BIA 3.0, 4.2): server/routes/opsCases.ts. */

export type OpsCaseStatus = 'open' | 'answered' | 'closed';

export interface OpsCaseSummary {
  id: string;
  caseNo: string;
  status: OpsCaseStatus;
  category: string;
  orderNo: string | null;
  headline: string;
  owner: 'account' | 'guest';
  customerName: string | null;
  createdAt: string;
}

export interface OpsCaseDetail extends OpsCaseSummary {
  summary: string;
  transcript: { role: 'user' | 'assistant'; content: string }[];
  opsReply: string | null;
  answeredAt: string | null;
  closedAt: string | null;
  customerPhone: string | null;
  orderId: string | null;
}

export const OPS_CASES_KEY = ['/api/ops/cases'] as const;

/** Thrown when the cases table isn't there yet (the migration not run). */
export class CasesNotSetUpError extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (res.status === 503) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    if (body.code === 'CASES_NOT_SET_UP') throw new CasesNotSetUpError(body.message ?? 'Cases are not set up yet.');
  }
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export function useOpsCases(status: OpsCaseStatus | 'all') {
  return useQuery({
    queryKey: [...OPS_CASES_KEY, status],
    queryFn: async () =>
      (await getJson<{ cases: OpsCaseSummary[] }>(status === 'all' ? '/api/ops/cases' : `/api/ops/cases?status=${status}`)).cases,
    retry: false,
    refetchOnMount: 'always',
  });
}

export function useOpsCase(id: string | undefined) {
  return useQuery({
    queryKey: [...OPS_CASES_KEY, 'detail', id],
    queryFn: async () => (await getJson<{ case: OpsCaseDetail }>(`/api/ops/cases/${encodeURIComponent(id ?? '')}`)).case,
    enabled: !!id,
    retry: false,
    refetchOnMount: 'always',
  });
}

/** How a category reads in the console (server/supportCases.ts §CASE_TOPICS). */
export const CASE_CATEGORY_LABELS: Record<string, string> = {
  damaged: 'Damaged parcel',
  lost: 'Missing parcel',
  delayed: 'Delayed delivery',
  refund: 'Refund or charge',
  customs: 'Customs hold',
  rider: 'Rider or pickup',
  cancel: 'Cancelling a booking',
  other: 'Other',
};

export const CASE_STATUS_STYLE: Record<OpsCaseStatus, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-amber-100 text-amber-800' },
  answered: { label: 'Answered', className: 'bg-emerald-100 text-emerald-700' },
  closed: { label: 'Closed', className: 'bg-[#F3F4F6] text-muted-foreground' },
};

export function formatCaseTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}
