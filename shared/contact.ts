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
 * Typed, pasted or saved input → the bare 10 digits. A leading `0` or `91`
 * beyond ten digits is a prefix, not part of the number: keeping the first ten
 * of `+91 7558372885` gave `9175583728` (BOM-100333), which still passes
 * `isIndianMobile` and went to ITD as the sender's phone.
 */
export function toIndianMobile(value: string): string {
  let digits = value.replace(/\D/g, "");
  while (digits.length > 10) {
    if (digits.startsWith("0")) digits = digits.slice(1);
    else if (digits.startsWith("91")) digits = digits.slice(2);
    else break;
  }
  return digits.slice(0, 10);
}

/**
 * A foreign number without its trunk `0`, ready for a dial code in front.
 * `+1` + `09198332075` reached ITD as the receiver's phone (BOM-100333).
 */
export function withoutTrunkZero(value: string): string {
  return value.replace(/\D/g, "").replace(/^0+/, "");
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
