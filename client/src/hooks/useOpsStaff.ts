import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { OPS_USERS_KEY, type OpsStaffUser } from '@/hooks/useOpsOrders';

export const OPS_BEATS_KEY = ['ops', 'beats'] as const;

export function opsStaffUserKey(id: string) {
  return ['/api/ops/users', id] as const;
}

export type OpsStaffDetail = {
  user: OpsStaffUser;
  beat_ids: string[];
};

export type OpsBeatSummary = {
  id: string;
  slug: string;
  name: string;
  hub: string;
  cutoff_hour: number;
  is_active: boolean;
  pincode_count: number;
  agents: { id: string; full_name: string | null }[];
};

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export function useOpsStaffUser(id: string | undefined) {
  return useQuery({
    queryKey: id ? opsStaffUserKey(id) : ['/api/ops/users', 'missing'],
    queryFn: async () => {
      const res = await fetch(`/api/ops/users/${id}`, { credentials: 'include' });
      return readJson<OpsStaffDetail>(res);
    },
    enabled: Boolean(id),
    retry: false,
    refetchOnMount: 'always',
  });
}

export function useOpsBeatsList() {
  return useQuery({
    queryKey: OPS_BEATS_KEY,
    queryFn: async () => {
      const res = await fetch('/api/ops/beats', { credentials: 'include' });
      const data = await readJson<{ beats: OpsBeatSummary[] }>(res);
      return data.beats;
    },
    retry: false,
    refetchOnMount: 'always',
  });
}

export function useUpdateStaffUser(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      full_name?: string;
      phone?: string;
      email?: string;
    }) => {
      const res = await apiRequest('PATCH', `/api/ops/users/${id}`, body);
      return (await res.json()) as { user: OpsStaffUser };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: OPS_USERS_KEY });
      void queryClient.invalidateQueries({ queryKey: opsStaffUserKey(id) });
    },
  });
}

export function useSetAgentBeats(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (beatIds: string[]) => {
      const res = await apiRequest('PUT', `/api/ops/users/${id}/beats`, {
        beat_ids: beatIds,
      });
      return (await res.json()) as { beat_ids: string[] };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: OPS_USERS_KEY });
      void queryClient.invalidateQueries({ queryKey: opsStaffUserKey(id) });
      void queryClient.invalidateQueries({ queryKey: OPS_BEATS_KEY });
    },
  });
}
