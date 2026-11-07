import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RewardLedgerKind, RewardsSummary } from '@shared/rewards';
import { apiRequest, readJson } from '@/lib/queryClient';

/** Reward points for one customer, as the ops console sees them. */
export function opsCustomerRewardsKey(id: string) {
  return ['/api/ops/customers', id, 'rewards'] as const;
}

export function useOpsCustomerRewards(id: string | undefined) {
  return useQuery({
    queryKey: id ? opsCustomerRewardsKey(id) : ['/api/ops/customers', 'missing', 'rewards'],
    queryFn: async () => {
      if (!id) throw new Error('404: Customer not found');
      const res = await fetch(`/api/ops/customers/${encodeURIComponent(id)}/rewards`, {
        credentials: 'include',
      });
      return readJson<RewardsSummary>(res);
    },
    enabled: Boolean(id),
    retry: false,
    refetchOnMount: 'always',
  });
}

/** Super admin: add (positive) or take away (negative) points, with a reason. */
export function useAdjustRewards(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { points: number; note: string }) => {
      const res = await apiRequest('POST', `/api/ops/customers/${encodeURIComponent(id)}/rewards/adjust`, input);
      return (await res.json()) as RewardsSummary;
    },
    onSuccess: (summary) => {
      if (summary && 'balance' in summary) qc.setQueryData(opsCustomerRewardsKey(id), summary);
      else void qc.invalidateQueries({ queryKey: opsCustomerRewardsKey(id) });
    },
  });
}

export type OpsRewardsLedgerRow = {
  id: string;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  kind: RewardLedgerKind;
  points: number;
  rupee_value: number;
  order_no: string | null;
  billed_incl_gst: number | null;
  gst_per: number | null;
  weight_kg: number;
  fy: string;
  note: string | null;
  adjusted_by: string | null;
};

/** Every points ledger row in one IST month (`YYYY-MM`), for the accounts CSV. */
export async function fetchOpsRewardsLedger(month: string): Promise<OpsRewardsLedgerRow[]> {
  const res = await fetch(`/api/ops/rewards/ledger?month=${encodeURIComponent(month)}`, {
    credentials: 'include',
  });
  const data = await readJson<{ rows: OpsRewardsLedgerRow[] }>(res);
  return data.rows;
}
