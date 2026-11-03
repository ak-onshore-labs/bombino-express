/**
 * The rules for a phone number and an email, in one place for both tiers.
 *
 * `/^\d{10}$/` was written out at nine call sites — seven screens and two zod
 * schemas — so a screen could accept what the server would reject, and the
 * message shown for it was retyped each time.
 *
 * Ten digits, no country code: every agent and member of staff is in India, and
 * the number is stored bare and prefixed with +91 for display. A CUSTOMER can
 * also sign in from any other country — see "Account phones" below.
 */

import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

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

// ── Account phones: India, or any country ──────────────────────────────────
//
// A customer's own number — the one they sign in with — is stored in one of
// two shapes, and nothing else:
//
//   Indian         "9876543210"      bare 10 digits, exactly as before
//   international  "+97450123456"    E.164: "+" dial code + number, no spaces
//
// Indian rows keep their old shape so nothing already saved has to move. The
// "+" is what tells the two apart: a bare number is always Indian.
//
// Every country is accepted (Aditya, 3 Nov 2026, after Qatar worked end to
// end). Whether a number is real for its country — length and leading digits —
// is libphonenumber-js's call, not a table of ours. MSG91 still has to deliver
// SMS to that country; WhatsApp reaches any country.

export interface PhoneCountry {
  /** ISO 3166 alpha-2, e.g. "QA". Unique; dial codes are not (+1 is shared). */
  iso: string;
  name: string;
  /** Digits only, no "+". */
  dialCode: string;
  flag: string;
}

/** "QA" → the regional-indicator flag emoji. */
function flagOf(iso: string): string {
  return String.fromCodePoint(
    ...iso
      .toUpperCase()
      .split("")
      .map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

let regionNames: Intl.DisplayNames | null = null;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionNames = null;
}

function countryOf(iso: CountryCode): PhoneCountry {
  return {
    iso,
    name: regionNames?.of(iso) ?? iso,
    dialCode: getCountryCallingCode(iso),
    flag: flagOf(iso),
  };
}

export const INDIA: PhoneCountry = countryOf("IN");

/** Every country, India first, the rest by name. */
export const ACCOUNT_PHONE_COUNTRIES: readonly PhoneCountry[] = [
  INDIA,
  ...getCountries()
    .filter((iso) => iso !== "IN")
    .map(countryOf)
    .sort((a, b) => a.name.localeCompare(b.name)),
];

const COUNTRY_BY_ISO = new Map(ACCOUNT_PHONE_COUNTRIES.map((c) => [c.iso, c]));

export function phoneCountryByIso(iso: string): PhoneCountry | null {
  return COUNTRY_BY_ISO.get(iso.toUpperCase()) ?? null;
}

export const ACCOUNT_PHONE_MESSAGE = "Enter a valid mobile number";

/** E.164 digits can never be longer than this, dial code included. */
const E164_MAX_DIGITS = 15;

/** "+97450123456": a valid number for a country other than India. */
export function isInternationalPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\+\d{6,15}$/.test(trimmed)) return false;
  const parsed = parsePhoneNumberFromString(trimmed);
  return (
    !!parsed &&
    !!parsed.country &&
    parsed.country !== "IN" &&
    parsed.countryCallingCode !== "91" &&
    parsed.isValid()
  );
}

/** A number someone can sign in with: Indian 10 digits, or any valid number abroad. */
export function isAccountPhone(value: string): boolean {
  return isIndianMobile(value) || isInternationalPhone(value);
}

/**
 * A country and what was typed → the stored form.
 *
 * India goes through `toIndianMobile`, so a pasted "+91 …" still lands on the
 * ten digits. Anywhere else: a complete number is normalised by
 * libphonenumber (trunk "0" dropped where the country uses one); a number
 * still being typed is kept as dial code + digits so the box can show it.
 */
export function toAccountPhone(iso: string, local: string): string {
  const country = phoneCountryByIso(iso) ?? INDIA;
  if (country.iso === "IN") return toIndianMobile(local);

  const raw = local.trim();
  // A pasted number that already carries its "+" and dial code.
  if (raw.startsWith("+")) {
    const pasted = parsePhoneNumberFromString(raw);
    if (pasted?.isValid()) return pasted.number;
    return `+${raw.replace(/\D/g, "").slice(0, E164_MAX_DIGITS)}`;
  }

  const parsed = parsePhoneNumberFromString(raw, country.iso as CountryCode);
  if (parsed?.isValid() && parsed.countryCallingCode === country.dialCode) return parsed.number;
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  return `+${country.dialCode}${digits.slice(0, E164_MAX_DIGITS - country.dialCode.length)}`;
}

/**
 * A stored number → its country and the local part, for an input to edit.
 *
 * `preferIso` breaks ties between countries that share a dial code (+1 is the
 * US, Canada and the Caribbean) while a number is only half typed.
 */
export function splitAccountPhone(
  stored: string | null | undefined,
  preferIso?: string,
): { country: PhoneCountry; local: string } {
  const trimmed = (stored ?? "").trim();
  if (trimmed.startsWith("+") && !trimmed.startsWith("+91")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    const preferred = preferIso ? phoneCountryByIso(preferIso) : null;
    if (preferred && preferred.iso !== "IN" && digits.startsWith(preferred.dialCode)) {
      return { country: preferred, local: digits.slice(preferred.dialCode.length) };
    }
    const parsed = parsePhoneNumberFromString(trimmed);
    const known = parsed?.country ? phoneCountryByIso(parsed.country) : null;
    if (parsed && known) return { country: known, local: parsed.nationalNumber };
    // Half typed: the longest dial code it starts with.
    let best: PhoneCountry | null = null;
    for (const c of ACCOUNT_PHONE_COUNTRIES) {
      if (
        c.iso !== "IN" &&
        digits.startsWith(c.dialCode) &&
        (!best || c.dialCode.length > best.dialCode.length)
      ) {
        best = c;
      }
    }
    if (best) return { country: best, local: digits.slice(best.dialCode.length) };
  }
  return { country: INDIA, local: toIndianMobile(trimmed) };
}

/** `+91 98765 43210` / `+974 5011 3086`. Anything unrecognised comes back as given. */
export function formatAccountPhone(stored: string | null | undefined): string {
  const value = (stored ?? "").trim();
  if (isInternationalPhone(value)) {
    return parsePhoneNumberFromString(value)?.formatInternational() ?? value;
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
  return isInternationalPhone(`+${digits}`) ? `+${digits}` : null;
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
