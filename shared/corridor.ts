/**
 * Which origin → destination pairs a customer can book in the app.
 *
 * Bombino books out of India to anywhere else. Anything else — inbound to
 * India, or between two other countries — is quoted but handed to the team.
 *
 * Shared so the Rates page and BIA give the same answer: BIA used to offer
 * "Create shipment" only for India → USA, long after the app itself opened
 * every destination.
 */

export const BOOKABLE_ORIGIN = "IN";

export function isBookableCorridor(origin: string, destination: string): boolean {
  return origin === BOOKABLE_ORIGIN && destination !== BOOKABLE_ORIGIN;
}
