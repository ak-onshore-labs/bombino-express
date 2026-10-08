/**
 * Carrier tracking for one AWB — `GET /api/track/:awb`.
 *
 * Shared by the shipment screen and the order screen, so a dispatched order
 * shows the same scans as tracking its AWB does, and the two cannot drift.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { TrackingEvent } from '@/lib/trackingTypes';
import { isAwbStatusFinal } from '@/lib/awbStatus';

export interface DocketEvent {
  id?: string;
  event_at: string;
  event_description: string;
  event_remark: string;
  event_state: string;
  event_location: string;
}

export interface ITDTrackingResult {
  errors: boolean;
  tracking_no: string;
  chargeable_weight: string;
  forwarding_no: string;
  docket_info: [string, string][];
  docket_events: DocketEvent[];
}

export type TrackingResponse =
  | { results: ITDTrackingResult[]; fromCache: false; lastTrackedAt: string }
  | { fromCache: true; lastTrackedAt: string; currentStatus: string; message: string };

export function getDocketValue(docketInfo: [string, string][], label: string): string {
  const entry = docketInfo.find(([key]) => key.trim() === label);
  return entry?.[1]?.trim() ?? '';
}

/** ITD's weight string ("2.000", "2.5 KG") as "2 kg". */
export function withKg(value: string): string {
  let trimmed = value.trim();
  if (!trimmed) return '';
  // Drop trailing zeros: "2.000" -> "2", "2.50" -> "2.5"
  const num = parseFloat(trimmed.replace(/[^0-9.]/g, ''));
  if (Number.isFinite(num)) {
    const hasKg = /\bkg\b/i.test(trimmed);
    trimmed = num.toString();
    return hasKg || !/^\d/.test(value) ? `${trimmed} kg` : `${trimmed} kg`;
  }
  return /\bkg\b/i.test(trimmed) ? trimmed : `${trimmed} kg`;
}

export function mapEvents(docketEvents: DocketEvent[]): TrackingEvent[] {
  return docketEvents.map((e, index) => ({
    id: e.id || `${e.event_at}-${index}`,
    status: e.event_description,
    note: e.event_remark || e.event_state || '',
    location: e.event_location || '',
    timestamp: new Date(e.event_at),
  }));
}

/**
 * The carrier's latest scan state, across both response shapes.
 *
 * The last docket event wins, then the docket's own Status field. Used to
 * decide whether this shipment is still worth polling; null means "cannot
 * tell", which is treated as still moving.
 */
export function latestScanState(data: TrackingResponse | undefined): string | null {
  if (!data) return null;
  if (data.fromCache) return data.currentStatus?.trim() || null;
  const result = data.results?.[0];
  if (!result) return null;
  const events = result.docket_events ?? [];
  const last = events.length > 0 ? events[events.length - 1] : undefined;
  return (
    last?.event_state?.trim() || getDocketValue(result.docket_info ?? [], 'Status') || null
  );
}

function isTrackingResponse(body: unknown): body is TrackingResponse {
  if (!body || typeof body !== 'object') return false;
  const o = body as Record<string, unknown>;
  if (o.fromCache === true) {
    return (
      typeof o.lastTrackedAt === 'string' &&
      typeof o.currentStatus === 'string' &&
      typeof o.message === 'string'
    );
  }
  if (o.fromCache === false) {
    return Array.isArray(o.results) && typeof o.lastTrackedAt === 'string';
  }
  return false;
}

export function trackingKey(awb: string): readonly unknown[] {
  return ['/api/track', awb];
}

export function useAwbTracking(
  awb: string,
  options?: { enabled?: boolean }
): UseQueryResult<TrackingResponse> {
  return useQuery<TrackingResponse>({
    queryKey: trackingKey(awb),
    queryFn: async () => {
      const res = await fetch(`/api/track/${encodeURIComponent(awb)}`, {
        credentials: 'include',
      });
      const body: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof body === 'object' &&
          body !== null &&
          'message' in body &&
          typeof (body as { message: unknown }).message === 'string'
            ? (body as { message: string }).message
            : res.statusText;
        throw new Error(`${res.status}: ${msg}`);
      }
      if (!isTrackingResponse(body)) {
        throw new Error('Invalid tracking response');
      }
      return body;
    },
    enabled: !!awb && (options?.enabled ?? true),
    retry: false,
    // Carrier scans arrive while the customer is watching. The global default
    // is `staleTime: Infinity`, which on a tracking screen means the page was
    // only ever as fresh as the moment it was opened.
    //
    // Two minutes, not twenty seconds: each call is a round trip to ITD, and a
    // parcel does not change state faster than that. Stops once ITD has said
    // its last word (`isAwbStatusFinal`) — a delivered parcel is not going to
    // move again, and this screen is one people leave open.
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      isAwbStatusFinal(latestScanState(query.state.data)) ? false : 120_000,
  });
}
