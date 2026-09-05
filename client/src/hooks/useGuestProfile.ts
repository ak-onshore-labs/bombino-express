import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { GuestProfile } from '@/lib/shadowProfile';

/**
 * The guest's profile, read from the server.
 *
 * Deliberately NOT on the Zustand store. `bombino-storage` is persisted to
 * localStorage, and a profile kept there is a per-browser copy: it survives a
 * sign-out it should not, it disappears when the customer opens the app on
 * their phone instead of their laptop, and nothing on the server can correct
 * it. This is a live read against `/api/guest/profile`, which resolves the
 * guest from the session's `guest_ref` — the same uuid that owns their staged
 * documents and their orders.
 *
 * A 401 here means "nobody has verified a number in this browser", which is a
 * normal state for a visitor rather than an error, so it resolves to null. The
 * interceptor in lib/session.ts is told the same thing: `/api/guest/` is in
 * NOT_AN_EXPIRY, so this cannot sign anyone out.
 */

export const GUEST_PROFILE_QUERY_KEY = ['/api/guest/profile'] as const;

async function fetchGuestProfile(): Promise<GuestProfile | null> {
  const res = await fetch('/api/guest/profile', {
    credentials: 'include',
    cache: 'no-store',
  });

  // 401 — no verified number in this session. 409 — this session is signed in,
  // so the account profile is the right screen. Neither is an error to show.
  if (res.status === 401 || res.status === 409) return null;
  if (!res.ok) throw new Error('Could not load your profile');
  return (await res.json()) as GuestProfile;
}

export function useGuestProfile(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: GUEST_PROFILE_QUERY_KEY,
    queryFn: fetchGuestProfile,
    enabled: options?.enabled ?? true,
    // The global default is `staleTime: Infinity`, which would leave a stale
    // profile on screen for the life of the tab. Thirty seconds instead of 0:
    // this is now read by five surfaces (the banner, both menus, Orders and
    // /profile), and re-fetching on every one of their mounts meant a request
    // per navigation for a record that changes rarely.
    //
    // Freshness where it matters is explicit rather than incidental — the save
    // writes the response into this cache, and booking invalidates it — so the
    // window only affects a profile changed somewhere else entirely.
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Anything a guest may answer, all optional.
 *
 * One-field-at-a-time saving is the whole point: the profile screen sends the
 * row that was just answered and nothing else, and the server leaves every
 * column it was not given alone.
 *
 * `gstin` is absent deliberately. It is written only by the identity check,
 * which has to reach the GST registry first — see ProfileFieldList.
 */
export interface GuestProfilePatch {
  full_name?: string;
  email?: string;
  account_type?: 'personal' | 'company';
  company_category?: string;
  company_name?: string;
  contact_person?: string;
  address_line_1?: string;
  pincode?: string;
  city?: string;
  state?: string;
  hub_id?: string;
  /** Merged into the stored object, not swapped for it. */
  extras?: Record<string, string>;
}

/**
 * Save the two fields a guest may give after the fact.
 *
 * The endpoint answers with the whole profile, so the result is written
 * straight into the cache — the progress ring and the field list redraw on the
 * same round trip instead of after a refetch the customer waits for.
 */
export function useSaveGuestProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: GuestProfilePatch): Promise<GuestProfile> => {
      const res = await apiRequest('PATCH', '/api/guest/profile', patch);
      return (await res.json()) as GuestProfile;
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(GUEST_PROFILE_QUERY_KEY, profile);
    },
  });
}

/** Drop the cached profile — after a sign-in, or a booking that changes it. */
export function invalidateGuestProfile(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: GUEST_PROFILE_QUERY_KEY });
}
