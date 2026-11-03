/**
 * The rules for a phone number and an email, in one place for both tiers.
 *
 * `/^\d{10}$/` was written out at nine call sites — seven screens and two zod
 * schemas — so a screen could accept what the server would reject, and the
 * message shown for it was retyped each time.
 *
 * Ten digits, no country code: every agent and member of staff is in India, and
 * the number is stored bare and prefixed with +91 for display. A CUSTOMER can
 * also sign in from a few other countries — see "Account phones" below.
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
 * `saved`, unless it is `known` cut the old way: "+91" kept and the last two
 * digits lost. Then `known`, the number it was cut from.
 *
 * `toIndianMobile` stops new input being cut, but addresses saved before it
 * still hold `9175583728` for `7558372885`, and picking one put the cut number
 * on BOM-100339. Ten digits either way, so only a known number can tell which
 * is right: the account's own phone.
 */
export function repairCutMobile(saved: string, known: string | null | undefined): string {
  // An account number from abroad was never cut the "+91" way.
  if ((known ?? "").trim().startsWith("+") && !(known ?? "").trim().startsWith("+91")) return saved;
  const knownTen = toIndianMobile(known ?? "");
  if (knownTen.length !== 10) return saved;
  return saved.trim() === ("91" + knownTen).slice(0, 10) ? knownTen : saved;
}

/**
 * A foreign number without its trunk `0`, ready for a dial code in front.
 * `+1` + `09198332075` reached ITD as the receiver's phone (BOM-100333).
 */
export function withoutTrunkZero(value: string): string {
  return value.replace(/\D/g, "").replace(/^0+/, "");
}

/**
 * A US or Canadian number (+1) has ten digits after the dial code, and its
 * area code never starts with 0 or 1. `+109198332075` broke both.
 */
export const NANP_LOCAL_PATTERN = /^[2-9]\d{9}$/;

export const NANP_PHONE_MESSAGE = "Enter the receiver's 10-digit phone number, like 212 555 0100";

/**
 * A receiver number as it goes to ITD: whatever the customer typed, as long as
 * it has 6 to 15 digits. No country code is added or required, and no country's
 * own format is enforced (Aditya, 8 Oct 2026: accept what is typed and file the
 * AWB). Blank is left to the "required" checks.
 */
export function isValidReceiverPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (!digits) return true;
  return digits.length >= 6 && digits.length <= 15;
}

/**
 * A receiver number for display, without the dial code the booking form used
 * to put in front of it (older orders were stored as "+1" + what was typed).
 */
export function withoutDialCode(phone: string, dialCode: string | null | undefined): string {
  const trimmed = phone.trim();
  const code = (dialCode ?? "").replace(/\D/g, "");
  if (!code || !trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  return digits.startsWith(code) && digits.length > code.length ? digits.slice(code.length) : trimmed;
}

// ── Account phones: India plus the countries we can send a login code to ─────
//
// A customer's own number — the one they sign in with — is stored in one of
// two shapes, and nothing else:
//
//   Indian         "9876543210"      bare 10 digits, exactly as before
//   international  "+97450123456"    "+" dial code + local number, no spaces
//
// Indian rows keep their old shape so nothing already saved has to move. The
// "+" is what tells the two apart: a bare number is always Indian.
//
// Only countries in this list are accepted. Each one costs money per code and
// has to be switched on in MSG91 first, so adding a country is a code change on
// purpose, not a setting. Qatar went live on MSG91 on 3 Nov 2026.

export interface PhoneCountry {
  /** ISO 3166 alpha-2, for keys and tests. */
  iso: string;
  name: string;
  /** Digits only, no "+". */
  dialCode: string;
  flag: string;
  /** How many digits the number has after the dial code. */
  localLength: number;
  /** An example local number, for the input's placeholder. */
  example: string;
}

export const INDIA: PhoneCountry = {
  iso: "IN",
  name: "India",
  dialCode: "91",
  flag: "🇮🇳",
  localLength: 10,
  example: "98765 43210",
};

/** Countries other than India that can sign in. MSG91 must be on for each. */
export const INTERNATIONAL_PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { iso: "QA", name: "Qatar", dialCode: "974", flag: "🇶🇦", localLength: 8, example: "5012 3456" },
];

export const ACCOUNT_PHONE_COUNTRIES: readonly PhoneCountry[] = [INDIA, ...INTERNATIONAL_PHONE_COUNTRIES];

export const ACCOUNT_PHONE_MESSAGE = "Enter a valid mobile number";

function countryForDialCode(dialCode: string): PhoneCountry | null {
  return ACCOUNT_PHONE_COUNTRIES.find((c) => c.dialCode === dialCode) ?? null;
}

/** The listed country whose dial code and length a run of digits matches. */
function internationalCountryOf(digits: string): PhoneCountry | null {
  for (const country of INTERNATIONAL_PHONE_COUNTRIES) {
    if (digits.startsWith(country.dialCode) && digits.length === country.dialCode.length + country.localLength) {
      return country;
    }
  }
  return null;
}

/** "+97450123456" for a listed country. Never true for an Indian number. */
export function isInternationalPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\+\d+$/.test(trimmed)) return false;
  return internationalCountryOf(trimmed.slice(1)) !== null;
}

/** A number someone can sign in with: Indian 10 digits, or a listed country. */
export function isAccountPhone(value: string): boolean {
  return isIndianMobile(value) || isInternationalPhone(value);
}

/**
 * A country and what was typed → the stored form. India goes through
 * `toIndianMobile`, so a pasted "+91 …" still lands on the ten digits.
 */
export function toAccountPhone(dialCode: string, local: string): string {
  if (dialCode === INDIA.dialCode) return toIndianMobile(local);
  const country = countryForDialCode(dialCode);
  let digits = withoutTrunkZero(local);
  // A pasted number that already carries the dial code.
  if (country && digits.length > country.localLength && digits.startsWith(dialCode)) {
    digits = digits.slice(dialCode.length);
  }
  if (country) digits = digits.slice(0, country.localLength);
  return `+${dialCode}${digits}`;
}

/** A stored number → its country and the local part, for an input to edit. */
export function splitAccountPhone(stored: string | null | undefined): { country: PhoneCountry; local: string } {
  const trimmed = (stored ?? "").trim();
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    for (const country of INTERNATIONAL_PHONE_COUNTRIES) {
      if (digits.startsWith(country.dialCode)) {
        return { country, local: digits.slice(country.dialCode.length) };
      }
    }
  }
  return { country: INDIA, local: toIndianMobile(trimmed) };
}

/** `+91 98765 43210` / `+974 5012 3456`. Anything unrecognised comes back as given. */
export function formatAccountPhone(stored: string | null | undefined): string {
  const value = (stored ?? "").trim();
  if (isInternationalPhone(value)) {
    const { country, local } = splitAccountPhone(value);
    const half = Math.ceil(local.length / 2);
    return `+${country.dialCode} ${local.slice(0, half)} ${local.slice(half)}`;
  }
  const ten = toIndianMobile(value);
  if (ten.length !== 10) return value;
  return `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;
}

/**
 * A stored number as SMS and WhatsApp want it: dial code + number, digits
 * only, no "+". Null for anything that is not an account phone.
 */
export function accountPhoneToMsisdn(stored: string | null | undefined): string | null {
  const value = (stored ?? "").trim();
  if (isInternationalPhone(value)) return value.slice(1);
  const ten = toIndianMobile(value);
  return isIndianMobile(ten) && /^[6-9]/.test(ten) ? `91${ten}` : null;
}

/**
 * The reverse: digits from a provider (a webhook `from`, a `to_phone` column)
 * → the stored form, so it can be matched against `itd_users.phone`.
 */
export function msisdnToAccountPhone(msisdn: string): string | null {
  const digits = msisdn.replace(/\D/g, "");
  if (/^91[6-9]\d{9}$/.test(digits)) return digits.slice(2);
  if (/^[6-9]\d{9}$/.test(digits)) return digits;
  return internationalCountryOf(digits) ? `+${digits}` : null;
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
