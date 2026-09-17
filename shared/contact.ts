/**
 * The rules for a phone number and an email, in one place for both tiers.
 *
 * `/^\d{10}$/` was written out at nine call sites — seven screens and two zod
 * schemas — so a screen could accept what the server would reject, and the
 * message shown for it was retyped each time.
 *
 * Ten digits, no country code: every customer and every agent is in India, and
 * the number is stored bare and prefixed with +91 for display.
 */

export const INDIAN_MOBILE_PATTERN = /^\d{10}$/;

export const INDIAN_MOBILE_MESSAGE = "Enter a valid 10-digit phone number";

export function isIndianMobile(value: string): boolean {
  return INDIAN_MOBILE_PATTERN.test(value.trim());
}

/**
 * Deliberately permissive: anything with a local part, an @, a dot and a TLD.
 * A stricter pattern rejects addresses that exist, and the only real proof is
 * mail that arrives.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}
