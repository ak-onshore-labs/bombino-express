/**
 * Indian wall-clock helpers, shared by client and server.
 *
 * TIMEZONE: `orders.pickup_date` is a bare `date` with no zone, and every
 * customer and every agent is in India, so "is this pickup today?" is only
 * meaningful in IST. Never answer that question with a raw `new Date()` on the
 * server, which runs in UTC — use `todayInIst()`.
 *
 * This file is what remains of `pickupSlots.ts`. Pickups no longer carry a time
 * window: the customer chooses a date, and the agent collects when they get
 * there. The slot vocabulary, the roster it was checked against, and the
 * before-the-window reminder all went with it.
 *
 * What survived the window is the cutoff — see `earliestPickupDate`.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Current wall-clock time in India, as a plain `{ date, hour, minute }`.
 *
 * Returns the date as `YYYY-MM-DD` so it compares directly against
 * `orders.pickup_date` without any further conversion.
 */
export function nowInIst(now: Date = new Date()): {
  date: string;
  hour: number;
  minute: number;
} {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/**
 * Instant for 00:00 Asia/Kolkata on an IST calendar day (`YYYY-MM-DD`).
 * Defaults to today IST. Same meaning as the agent collections window start.
 */
export function startOfIstDayIso(day: string = nowInIst().date): string {
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

/** Today in India, `YYYY-MM-DD`. The earliest bookable pickup date. */
export function todayInIst(now: Date = new Date()): string {
  return nowInIst(now).date;
}

/**
 * Day of week for a `YYYY-MM-DD` date. 0 = Sunday … 6 = Saturday, matching
 * `Date.getUTCDay()`.
 *
 * Timezone-safe by construction: a calendar date has exactly one weekday, so
 * parsing it as UTC midnight cannot drift it. Parsing as local midnight would
 * be fine too, but UTC keeps server and client identical.
 */
export function dayOfWeekForDate(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

/** Index matches `dayOfWeekForDate` — do not reorder. */
export const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

// ── Booking cutoff ────────────────────────────────────────────────────────

/**
 * After this hour (IST), today is no longer bookable for pickup.
 *
 * Ops needs the back half of the afternoon to route what has already been
 * booked; a pickup accepted after the local cutoff is one nobody can reach.
 * 15 means the cutoff falls at 15:00 exactly — 14:59 still books today, 15:00
 * does not.
 *
 * This is the floor, not the rule: each hub runs its own cutoff (Fort's riders
 * are out until 7 PM, Delhi's until 5) and callers pass that hour in. It stays
 * the default for a pincode no hub claims — see `PICKUP_CUTOFF_HOUR_BY_HUB` in
 * shared/pickupPincodes.ts.
 */
export const PICKUP_CUTOFF_HOUR = 15;

/** Tomorrow, for a `YYYY-MM-DD` date. Parsed as UTC midnight, which a bare
 *  calendar date survives in any zone. */
function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The earliest date a pickup may be booked for: today before the cutoff,
 * tomorrow from the cutoff onwards. `cutoffHour` is the collecting hub's own
 * cutoff; omit it for the conservative default.
 *
 * The single source of the rule. The booking form disables everything before
 * it, and `POST /api/orders` rejects anything before it — the form's copy is a
 * convenience, since the cutoff can pass while a customer is still filling the
 * rest of it in, and nothing stops a hand-crafted request.
 */
export function earliestPickupDate(
  cutoffHour: number = PICKUP_CUTOFF_HOUR,
  now: Date = new Date()
): string {
  const ist = nowInIst(now);
  return ist.hour >= cutoffHour ? nextDay(ist.date) : ist.date;
}
