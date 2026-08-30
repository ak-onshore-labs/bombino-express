/**
 * Date segregation for the agent's job lists.
 *
 * One axis across every agent screen: when is this pickup due. It is the only
 * question that changes what an agent does next — a job for Thursday is not
 * work, it is a commitment, and mixing the two into one scroll is what made
 * the lists unreadable.
 *
 * Deliberately three bands, not five. "Tomorrow" and "next week" call for the
 * same response (nothing today), so they share a band and each card carries
 * its own date. Overdue earns its own band because it is the opposite: a
 * promise already broken, and the one thing that should never sit below the
 * fold.
 *
 * TIMEZONE: compares `YYYY-MM-DD` strings against `todayInIst`, never a raw
 * `new Date()`. `pickup_date` is an Indian calendar date and the server runs
 * in UTC; between 18:30 and midnight UTC they disagree, which is the middle of
 * an Indian working evening.
 */

import { todayInIst } from '@shared/istTime';
import type { PickupEntry } from '@/hooks/useAgentPickups';

export type DateBand = 'overdue' | 'today' | 'scheduled' | 'undated';

/**
 * One or two short words, per the v2 vocabulary. "Overdue" and "Scheduled" were
 * the two longest words on the surface and neither is how an agent says it.
 */
export const BAND_LABEL: Record<DateBand, string> = {
  overdue: 'Late',
  today: 'Today',
  scheduled: 'Later',
  undated: 'No date',
};

/*
 * The BAND_TONE table that used to live here is gone.
 *
 * It handed each band a panel fill, a row fill, an eyebrow, a meta and a rule
 * colour, from back when a band was one panel of hairlined rows and the band
 * head carried a hairline of its own. In v4 a job is a card that owns its own
 * border, and there is exactly one thing a band still changes: whether it is
 * late. `bandForDate(...) === 'overdue'` is that whole rule, read directly by
 * the cards, and a lookup table for one boolean was five ways to get it wrong.
 *
 * The colour law itself has not moved: amber is money and the agent's next
 * concern, navy is a state change they commit, `#B91C1C` on `#FEF2F2` is late,
 * and everything else is grey.
 */

export function bandForDate(pickupDate: string | null, today = todayInIst()): DateBand {
  if (!pickupDate) return 'undated';
  if (pickupDate < today) return 'overdue';
  if (pickupDate === today) return 'today';
  return 'scheduled';
}

export function bandForEntry(entry: PickupEntry, today = todayInIst()): DateBand {
  return bandForDate(entry.order.pickup_date, today);
}

/*
 * `groupByDate` used to live here, splitting a list into all four bands at
 * once. Every screen now shows two bands and names them itself — New shows Late
 * and Today, My jobs shows Today and Later — because which bands a screen shows
 * turned out to be a decision about that screen rather than a property of the
 * list. The server already returns each list in the order the bands want.
 */

/**
 * Held jobs that count as today's work.
 *
 * Includes overdue: a pickup that slipped a day is late, not cancelled, and it
 * is still the thing the agent should be doing right now. Excludes anything
 * dated forward, which belongs in My pickups under Scheduled.
 */
export function isTodaysWork(entry: PickupEntry, today = todayInIst()): boolean {
  const band = bandForEntry(entry, today);
  return band === 'today' || band === 'overdue' || band === 'undated';
}
