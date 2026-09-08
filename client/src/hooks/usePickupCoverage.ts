/**
 * Which pincodes we collect from, and by when.
 *
 * Fetched once and resolved locally after that. The booking form asks the
 * question on every keystroke of the sender's pincode — is pickup even on
 * offer, and what cutoff applies — and a round trip per keystroke would answer
 * a moment after the customer had already moved on.
 *
 * `initialData` is the table compiled into the bundle, so the form is right on
 * first paint and stays right if the request never lands. That is the same
 * property the static import had before coverage moved into the database, and
 * it is the reason this can be a hook at all: nothing here can leave a customer
 * waiting on a network call to find out whether they may book a pickup.
 *
 * The server re-checks both at `POST /api/orders` regardless. This map can go
 * stale mid-booking — ops may retire a beat while a form is open — and the 409
 * is what catches that.
 */

import { useQuery } from '@tanstack/react-query';
import {
  STATIC_COVERAGE,
  buildCoverage,
  type CoverageRow,
  type PickupArea,
} from '@shared/pickupPincodes';

export const PICKUP_COVERAGE_KEY = ['pickup-coverage'] as const;

type CoverageResponse = {
  areas: Record<string, PickupArea>;
  cities: string[];
  /** 'static' means the server fell back to its compiled-in table. */
  source: 'db' | 'static';
};

/** Five minutes, matching the server's cache and its Cache-Control. */
const STALE_MS = 5 * 60 * 1000;

function toCoverage(payload: CoverageResponse): ReadonlyMap<string, PickupArea> {
  const rows: CoverageRow[] = Object.keys(payload.areas).map((pincode) => ({
    pincode,
    ...payload.areas[pincode],
  }));
  // Already reconciled server-side — one entry per pincode — but rebuilt through
  // the same function so a malformed payload cannot produce a shape the lookups
  // do not expect.
  return buildCoverage(rows);
}

/**
 * The coverage map to hand to `getPickupServiceability`, `isPickupBlocked` and
 * `pickupCutoffHour`. Never null, never loading — there is always an answer.
 */
export function usePickupCoverage(): ReadonlyMap<string, PickupArea> {
  const { data } = useQuery({
    queryKey: PICKUP_COVERAGE_KEY,
    queryFn: async (): Promise<ReadonlyMap<string, PickupArea>> => {
      const res = await fetch('/api/pickup/coverage', { credentials: 'include' });
      if (!res.ok) throw new Error('Could not load pickup coverage');
      return toCoverage((await res.json()) as CoverageResponse);
    },
    initialData: STATIC_COVERAGE,
    // Dated to the epoch on purpose. `initialData` with a `staleTime` counts as
    // fresh from the moment it is supplied, so without this the seed would
    // satisfy the query for five minutes and the beats ops actually edited
    // would never be fetched at all. Zero makes it stale immediately: the
    // static map paints, and the real one replaces it as soon as it lands.
    initialDataUpdatedAt: 0,
    staleTime: STALE_MS,
    // A booking in progress must not have the ground move under it, and a
    // refetch on every window focus would do exactly that.
    refetchOnWindowFocus: false,
  });

  return data;
}
