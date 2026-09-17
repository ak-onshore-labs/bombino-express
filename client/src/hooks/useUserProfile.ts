import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, readJson } from '@/lib/queryClient';

/**
 * The signed-in customer's own record, as `GET /api/user/profile` sends it
 * (server/appDb.ts §ITD_USER_PUBLIC_COLUMNS, plus the derived `has_password`).
 *
 * The profile screens used to keep this in `useState<any>` filled by a bare
 * `useEffect` + `fetch`, and patch it by hand after each save — a React Query
 * cache re-implemented badly, and the source of most of the client's `any`.
 */
export interface UserProfile {
  id: string;
  itd_customer_id: string | null;
  itd_customer_code: string | null;
  full_name: string | null;
  email: string | null;
  username: string | null;
  phone: string | null;
  role: string | null;
  account_type: 'personal' | 'company' | null;
  company_name: string | null;
  gstin: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
  last_login_at: string | null;
  /** Whether a password is stored, which decides if changing the number asks for one. */
  has_password: boolean;
}

export const USER_PROFILE_KEY = ['/api/user/profile'] as const;

export function useUserProfile(enabled = true) {
  return useQuery<UserProfile>({
    queryKey: USER_PROFILE_KEY,
    queryFn: async () => {
      const res = await fetch('/api/user/profile', { credentials: 'include' });
      return readJson<UserProfile>(res);
    },
    enabled,
    retry: false,
  });
}

/**
 * Change what this account shows: `username`, `email`, or both. The answer is
 * the saved row, so the cache is replaced rather than patched.
 */
export function useSaveUserProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { username?: string; email?: string }): Promise<UserProfile> => {
      const res = await apiRequest('PATCH', '/api/user/profile', patch);
      return (await res.json()) as UserProfile;
    },
    onSuccess: (profile) => queryClient.setQueryData(USER_PROFILE_KEY, profile),
  });
}

/**
 * After a change made elsewhere — a number linked, unlinked or replaced — ask
 * the server again instead of guessing what the row now says.
 */
export function useRefreshUserProfile() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: USER_PROFILE_KEY });
}
