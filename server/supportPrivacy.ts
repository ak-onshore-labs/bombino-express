/**
 * Keep identity numbers out of what BIA sends to OpenAI and what we store.
 *
 * Customers paste their Aadhaar or PAN into chat when they are stuck on the
 * identity step. BIA never needs the number — the tools read what is on file —
 * so it is masked to its last four before the model call and before the
 * transcript is saved. The last four is what the app shows back anyway.
 *
 * Deliberately not "mask every long number". A 12-digit number is just as
 * often an AWB, and masking those would break tracking. So a 12-digit run is
 * treated as an Aadhaar only when it looks like one: printed in the card's
 * 4-4-4 grouping, or in a message that says Aadhaar. Either way it is masked
 * whether or not its check digit is right — a mistyped Aadhaar is still eleven
 * of someone's twelve digits.
 */

const MASK = "••••";

/** "1234 5678 9012" or "1234-5678-9012", as printed on the card. */
const GROUPED_AADHAAR = /\b\d{4}[ -]\d{4}[ -](\d{4})\b/g;
const BARE_TWELVE = /\b\d{8}(\d{4})\b/g;
const SAYS_AADHAAR = /\b(aa?dh?aa?r|uidai|uid)\b/i;
/** Five letters, four digits, a letter: nothing else in the app looks like it. */
const PAN = /\b[a-z]{5}\d{4}([a-z])\b/gi;
/** A bank account number, when the message says that is what it is. */
const ACCOUNT_NUMBER = /\b((?:a\/c|acct|account)(?:\s*(?:no\.?|number|#))?\s*[:-]?\s*)\d{5,14}(\d{4})\b/gi;

export function maskSensitive(text: string): string {
  let out = text.replace(GROUPED_AADHAAR, (_m, last: string) => `${MASK}${last}`);
  if (SAYS_AADHAAR.test(out)) out = out.replace(BARE_TWELVE, (_m, last: string) => `${MASK}${last}`);
  out = out.replace(PAN, (m: string) => `${MASK}${m.slice(-4).toUpperCase()}`);
  out = out.replace(ACCOUNT_NUMBER, (_m, lead: string, last: string) => `${lead}${MASK}${last}`);
  return out;
}
