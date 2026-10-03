/**
 * Where every quote is priced from: Mumbai.
 *
 * ITD has a rate card for one India origin hub only. Asked for each of the 30
 * hubs in its hub master on 1 Oct 2026, every one but MUMBAI (B1001) answered
 * "No Rate Found" (docs/itd-issues/rates-by-origin-hub-2026-10-01.txt). So the
 * server pins `origin_hub_code` to Mumbai on every rate call, and a customer
 * sending from anywhere else is told the quote covers Mumbai onwards: getting
 * the parcel from their city to Mumbai costs extra, which the Bombino team
 * works out and tells them.
 */

import type { PickupArea } from './pickupPincodes.js';

/** ITD hub code for MUMBAI, from its hub master. */
export const RATE_ORIGIN_HUB_CODE = 'B1001';

/** The city a quote is priced from, as the customer reads it. */
export const RATE_ORIGIN_CITY = 'Mumbai';

/**
 * Cities the Mumbai hubs collect from themselves. Thane and Navi Mumbai are run
 * from Andheri like any Mumbai suburb, so there is no leg to Mumbai to charge.
 */
const MUMBAI_REGION_CITIES: readonly string[] = ['Mumbai', 'Thane', 'Navi Mumbai'];

const SIX_DIGITS = /^[0-9]{6}$/;

export type RateOrigin =
  | { outsideMumbai: false }
  /** `city` is null when nothing tells us its name. */
  | { outsideMumbai: true; city: string | null };

/**
 * Is a parcel sent from `pincode` priced from somewhere other than where it is?
 *
 * Read from the pickup coverage map first, since that is where ops name each
 * pincode's city. A pincode no beat covers falls back to its prefix: 400xxx is
 * Mumbai, Thane and Navi Mumbai. A blank or part-typed pincode is not known to
 * be anywhere, so it reads as Mumbai and no note is shown.
 *
 * `cityHint` is the city the customer typed, used only to name a city the
 * coverage map does not know.
 */
export function rateOriginFor(
  pincode: string | null | undefined,
  coverage: ReadonlyMap<string, PickupArea>,
  cityHint?: string | null
): RateOrigin {
  const code = (pincode ?? '').trim();
  if (!SIX_DIGITS.test(code)) return { outsideMumbai: false };

  const area = coverage.get(code);
  if (area) {
    return MUMBAI_REGION_CITIES.includes(area.city)
      ? { outsideMumbai: false }
      : { outsideMumbai: true, city: area.city };
  }

  if (code.startsWith('400')) return { outsideMumbai: false };
  const hint = cityHint?.trim();
  return { outsideMumbai: true, city: hint ? hint : null };
}

/** The note shown beside a quote for a parcel sent from outside Mumbai. */
export function rateOriginNote(city: string | null): string {
  const from = city ? `from ${city} ` : '';
  return (
    `These rates are from ${RATE_ORIGIN_CITY}. Extra charges for bringing your parcel ` +
    `${from}to ${RATE_ORIGIN_CITY} will be calculated and shared with you by the Bombino team.`
  );
}
