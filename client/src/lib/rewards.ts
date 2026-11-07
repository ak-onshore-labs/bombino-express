/**
 * Bombino Rewards on the client: the data hook, who may see it, and the
 * formatting the screens share.
 *
 * Rules and constants live in `@shared/rewards` (the server uses the same
 * file); figures come from GET /api/rewards. Phase 1 is points only plus one
 * weight milestone — see docs/rewards/rewards-plan.md.
 */

import { useQuery } from '@tanstack/react-query';
import { fyLastDay, type RewardLedgerKind, type RewardsSummary } from '@shared/rewards';
import { useAppStore } from '@/lib/store';
import { surfaceForRole } from '@/lib/surface';

export const REWARDS_QUERY_KEY = ['/api/rewards'] as const;

async function fetchRewards(): Promise<RewardsSummary | null> {
  const res = await fetch('/api/rewards', { credentials: 'include', cache: 'no-store' });
  // Signed out, or a guest session: nothing to show, not an error.
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('Failed to load reward points');
  return (await res.json()) as RewardsSummary;
}

/**
 * Rewards are for account holders. A guest, verified number or not, has no
 * account to hold points against and never earns, so nothing about rewards is
 * shown to them: no Home card, no menu link, no /rewards screen. Staff and
 * agents have their own surfaces; the role is checked so a stale session
 * cannot slip through.
 */
export function canSeeRewards(isLoggedIn: boolean, role: string | undefined): boolean {
  return isLoggedIn && surfaceForRole(role) === 'customer';
}

export function useRewardsAccess(): boolean {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const role = useAppStore((s) => s.user?.role);
  return canSeeRewards(isLoggedIn, role);
}

export function useRewards(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: REWARDS_QUERY_KEY,
    queryFn: fetchRewards,
    enabled: options?.enabled ?? true,
    // Global default is staleTime: Infinity. Points land when ops dispatches
    // an order, so re-read whenever a rewards surface mounts.
    staleTime: 0,
    retry: false,
  });
}

const pointsFormat = new Intl.NumberFormat('en-IN');

export function formatPoints(n: number): string {
  return pointsFormat.format(Math.round(n));
}

export function formatKg(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  return `${pointsFormat.format(rounded)} kg`;
}

/** Days left in the FY, counting today, by the IST calendar. */
export function daysLeftInFy(fy: string, now: Date = new Date()): number {
  const end = new Date(`${fyLastDay(fy)}T23:59:59+05:30`).getTime();
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}

/** "31 Mar 2027" from "2027-03-31". */
export function formatDayLong(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}

/** "FY 2026–27" from "2026-27". */
export function fyLabel(fy: string): string {
  return `FY ${fy.replace('-', '–')}`;
}

/** Expiry gets loud in the last month of the year (from 1 March). */
export const EXPIRY_WARNING_DAYS = 31;

export function ledgerLabel(kind: RewardLedgerKind, note: string | null): string {
  switch (kind) {
    case 'earn':
      return 'Earned on a shipment';
    case 'redeem':
      return 'Used on a booking';
    case 'redeem_back':
      return 'Points returned';
    case 'clawback':
      return 'Taken back: refund or return';
    case 'expiry':
      return 'Expired at year end';
    case 'adjust':
      return note?.trim() || 'Adjusted by Bombino';
  }
}
