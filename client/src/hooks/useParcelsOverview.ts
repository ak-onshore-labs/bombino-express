/**
 * Both sides of a person's parcels at a glance: what they sent and what is
 * coming to them, and how many of those moved since they last looked.
 *
 * Home's quick-access card and the badge on the Orders tab read this. It reads
 * the same queries Orders does (useOrderHistory, useGuestProfile,
 * useReceiving), so it adds no requests of its own beyond the cache those
 * already keep.
 *
 * "Since they last looked" is a timestamp on this device, set whenever Orders
 * is open. It is a convenience, not a record: a cleared browser just shows the
 * first-visit count again. First visit (no timestamp yet) counts only incoming
 * parcels still on their way — someone who has just been sent a parcel should
 * see a number; someone with fifty old bookings should not.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAppStore } from '@/lib/store';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { useOrderHistory } from '@/hooks/useCustomerOrders';
import { useReceiving } from '@/hooks/useReceiving';
import { guestOrderToRow, receivingToRow, type DisplayRow } from '@/lib/shipmentRows';

const SEEN_KEY = 'bombino-orders-seen';
const SEEN_EVENT = 'bombino-orders-seen';

/** Seen times, keyed by whose parcels they are (account id or guest phone). */
function readSeen(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeSeen(owner: string, at: string): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...readSeen(), [owner]: at }));
  } catch {
    // Storage blocked: the badge just keeps its count until next time.
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(SEEN_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(SEEN_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function snapshot(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function changedSince(rows: DisplayRow[], seenAt: string | null): number {
  if (!seenAt) return 0;
  const seen = Date.parse(seenAt);
  return rows.filter((row) => Date.parse(row.updatedAt) > seen).length;
}

export interface ParcelsOverview {
  /** Whether this person has proved a number at all. Nothing to show otherwise. */
  hasIdentity: boolean;
  loading: boolean;
  sending: DisplayRow[];
  receiving: DisplayRow[];
  sendingLive: number;
  receivingLive: number;
  unseenSending: number;
  unseenReceiving: number;
  /** What the Orders tab badge shows. */
  unseen: number;
  /** Mark everything as seen now. Orders calls it while open. */
  markSeen: () => void;
}

export function useParcelsOverview(): ParcelsOverview {
  const isLoggedIn = useAppStore((s) => s.isLoggedIn);
  const userId = useAppStore((s) => s.user?.id ?? null);
  const { data: guestProfile, isLoading: guestLoading } = useGuestProfile({ enabled: !isLoggedIn });
  const isGuest = !isLoggedIn && !!guestProfile;
  const hasIdentity = isLoggedIn || isGuest;

  const { data: history, isLoading: historyLoading } = useOrderHistory(isLoggedIn);
  const { data: incoming, isLoading: receivingLoading } = useReceiving(hasIdentity);

  const sending = useMemo<DisplayRow[]>(
    () => (isLoggedIn ? (history ?? []) : isGuest && guestProfile ? guestProfile.orders.map(guestOrderToRow) : []),
    [isLoggedIn, isGuest, history, guestProfile],
  );
  const receiving = useMemo(() => (incoming ?? []).map(receivingToRow), [incoming]);

  const owner = isLoggedIn ? (userId ? `a:${userId}` : null) : guestProfile?.phone ? `g:${guestProfile.phone}` : null;
  const seenJson = useSyncExternalStore(subscribe, snapshot, () => '');
  const seenAt = useMemo(() => {
    if (!owner) return null;
    try {
      const all = seenJson ? (JSON.parse(seenJson) as Record<string, string>) : {};
      return typeof all[owner] === 'string' ? all[owner] : null;
    } catch {
      return null;
    }
  }, [owner, seenJson]);

  const firstVisit = !!owner && seenAt === null;
  const unseenSending = changedSince(sending, seenAt);
  const unseenReceiving = firstVisit ? receiving.filter((r) => r.isLive).length : changedSince(receiving, seenAt);

  const markSeen = useCallback(() => {
    if (owner) writeSeen(owner, new Date().toISOString());
  }, [owner]);

  return {
    hasIdentity,
    loading: (isLoggedIn ? historyLoading : guestLoading) || (hasIdentity && receivingLoading),
    sending,
    receiving,
    sendingLive: sending.filter((r) => r.isLive).length,
    receivingLive: receiving.filter((r) => r.isLive).length,
    unseenSending,
    unseenReceiving,
    unseen: hasIdentity ? unseenSending + unseenReceiving : 0,
    markSeen,
  };
}

/**
 * Keep Orders marked as seen while it is open: on arrival, and again whenever
 * fresh data lands, so an update that arrives while you are looking at it
 * never comes back as a badge.
 */
export function useMarkOrdersSeen(): void {
  const { markSeen, sending, receiving, hasIdentity } = useParcelsOverview();
  useEffect(() => {
    if (hasIdentity) markSeen();
  }, [hasIdentity, markSeen, sending, receiving]);
}
