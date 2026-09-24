import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { matchesOpsSection } from '@shared/opsBoardQuery';
import { useOpsApplications } from '@/hooks/useOpsApplications';
import { OPS_ORDERS_KEY, fetchOpsOrders } from '@/hooks/useOpsOrders';
import { isOpsNavActive } from '@/lib/opsNav';
import { useAppStore } from '@/lib/store';

/**
 * The ops nav's "new" pills: how many things arrived in a section since this
 * person last had it open.
 *
 * Only sections things come *in* to from outside get one — a new pickup, a new
 * drop-off, an application sent or resent. Dispatched, Transactions and the
 * rest move because ops moved them, so a count there would only echo their own
 * work back at them.
 *
 * "Last had it open" is kept per ops user in this browser, as the newest
 * arrival they were shown (a server timestamp, so a skewed laptop clock can
 * neither hide nor invent anything). Having a section open keeps it at zero.
 */

/** Sections with a pill, by nav path. */
export const OPS_BADGED_PATHS = ['/ops/pickups', '/ops/dropoffs', '/ops/applications'] as const;
type BadgedPath = (typeof OPS_BADGED_PATHS)[number];

/** Path → newest arrival already seen, epoch ms. */
type Seen = Partial<Record<BadgedPath, number>>;

const POLL_MS = 60_000;

/** A first look on this browser counts what came in over the last day. */
const FIRST_LOOK_WINDOW_MS = 24 * 60 * 60 * 1000;

function storageKey(userId: string): string {
  return `bombino-ops-seen:${userId}`;
}

function readSeen(userId: string): Seen {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const seen: Seen = {};
    for (const path of OPS_BADGED_PATHS) {
      const value = (parsed as Record<string, unknown>)[path];
      if (typeof value === 'number' && Number.isFinite(value)) seen[path] = value;
    }
    return seen;
  } catch {
    return {};
  }
}

function writeSeen(userId: string, seen: Seen): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(seen));
  } catch {
    // Private window or blocked storage: the pills reset on the next page, no harm.
  }
}

function toMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/** Nav path → count of new things. Paths without a pill are absent. */
export function useOpsNavBadges(): Partial<Record<string, number>> {
  const [location] = useLocation();
  const userId = useAppStore((s) => s.user?.id) ?? 'anonymous';

  // Same cache as the boards; this observer adds the polling.
  const orders = useQuery({
    queryKey: OPS_ORDERS_KEY,
    queryFn: fetchOpsOrders,
    retry: false,
    staleTime: 30_000,
    refetchInterval: POLL_MS,
  });
  // Same cache as the queue's default "Open" filter, which already polls.
  const applications = useOpsApplications('open');

  const arrivals = useMemo<Record<BadgedPath, number[]>>(() => {
    const list = orders.data ?? [];
    return {
      '/ops/pickups': list.filter((o) => matchesOpsSection(o, 'pickups')).map((o) => toMs(o.created_at)),
      '/ops/dropoffs': list.filter((o) => matchesOpsSection(o, 'dropoffs')).map((o) => toMs(o.created_at)),
      // Waiting for someone to pick it up: new, edited, resent, or put back.
      '/ops/applications': (applications.data?.applications ?? [])
        .filter((a) => a.status === 'submitted')
        .map((a) => toMs(a.updated_at)),
    };
  }, [orders.data, applications.data]);

  const [seen, setSeen] = useState<Seen>(() => readSeen(userId));

  // Another person signed in on this browser, or a first look: fill the gaps
  // once, so the baseline doesn't slide forward on every page.
  useEffect(() => {
    const stored = readSeen(userId);
    const missing = OPS_BADGED_PATHS.filter((path) => stored[path] === undefined);
    if (missing.length > 0) {
      const baseline = Date.now() - FIRST_LOOK_WINDOW_MS;
      for (const path of missing) stored[path] = baseline;
      writeSeen(userId, stored);
    }
    setSeen(stored);
  }, [userId]);

  // The section on screen is seen, up to the newest thing in it.
  const activePath = OPS_BADGED_PATHS.find((path) => isOpsNavActive(location, path));
  useEffect(() => {
    if (!activePath) return;
    const newest = Math.max(0, ...arrivals[activePath]);
    if (newest <= (seen[activePath] ?? 0)) return;
    const next = { ...seen, [activePath]: newest };
    writeSeen(userId, next);
    setSeen(next);
  }, [activePath, arrivals, seen, userId]);

  return useMemo(() => {
    const fallback = Date.now() - FIRST_LOOK_WINDOW_MS;
    const out: Partial<Record<string, number>> = {};
    for (const path of OPS_BADGED_PATHS) {
      if (path === activePath) {
        out[path] = 0;
        continue;
      }
      const since = seen[path] ?? fallback;
      out[path] = arrivals[path].filter((at) => at > since).length;
    }
    return out;
  }, [activePath, arrivals, seen]);
}
