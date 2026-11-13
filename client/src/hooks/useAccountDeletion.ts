/**
 * Preflight and confirm for in-app account deletion.
 * Picks account vs guest endpoints from whether the store is signed in.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/lib/store';
import { apiRequest, readJson } from '@/lib/queryClient';
import { GUEST_PROFILE_QUERY_KEY } from '@/hooks/useGuestProfile';
import { NOTIFICATIONS_KEY } from '@/hooks/useCustomerOrders';

export type DeletionBlocker = {
  order_no: string | null;
  reason: string;
};

export type DeletionPreflight = {
  allowed: boolean;
  blockers: DeletionBlocker[];
  phone_last4: string | null;
};

export function useAccountDeletion() {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const logout = useAppStore((s) => s.logout);
  const queryClient = useQueryClient();

  const preflightPath = isLoggedIn
    ? '/api/account/delete/preflight'
    : '/api/guest/delete/preflight';
  const deletePath = isLoggedIn ? '/api/account/delete' : '/api/guest/delete';

  const preflight = useQuery({
    queryKey: ['account-delete-preflight', isLoggedIn ? 'account' : 'guest'],
    queryFn: async (): Promise<DeletionPreflight> => {
      const res = await apiRequest('GET', preflightPath);
      return readJson<DeletionPreflight>(res);
    },
    retry: false,
  });

  const requestOtp = useMutation({
    mutationFn: async (phone: string) => {
      await apiRequest('POST', '/api/auth/otp/request', {
        phone,
        purpose: 'auth',
      });
    },
  });

  const confirmDelete = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest('POST', deletePath, { code });
      return readJson<{ deleted: boolean }>(res);
    },
    onSuccess: () => {
      logout();
      queryClient.setQueryData(GUEST_PROFILE_QUERY_KEY, null);
      queryClient.removeQueries({ queryKey: NOTIFICATIONS_KEY });
      queryClient.removeQueries({
        queryKey: ['account-delete-preflight'],
      });
    },
  });

  return {
    isLoggedIn,
    preflight,
    requestOtp,
    confirmDelete,
  };
}
