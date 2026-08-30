// Aadhaar number validation only — no registry lookup, because there is no
// longer one to make. DigiLocker was removed and Offline Aadhaar Verification
// was never provisioned on the Cashfree account, so nothing asks UIDAI
// whether this number is issued or whose it is. What stands behind an Aadhaar
// number now is the card uploaded at the documents step, which Smart OCR must
// read as this same number. See server/cashfreeIdentity.ts.
//
// Shared between client and server so both sides agree on what counts as a
// valid Aadhaar, exactly as shared/gstin.ts does for a GSTIN. The form must
// not accept a number the server will then refuse.

/**
 * The Verhoeff check digit UIDAI puts on every Aadhaar number.
 *
 * Worth implementing precisely *because* nothing else checks this number. A
 * plain /^\d{12}$/ accepts every transposed pair and every mistyped digit,
 * and the customer only finds out one step later when their real card fails
 * to match — having been told the number was fine. Verhoeff catches all
 * single-digit errors and all adjacent transpositions, which is most of what
 * people actually get wrong copying twelve digits off a card.
 *
 * It says nothing about whether the number is issued or whose it is.
 *
 * Tables are the standard ones: D is the dihedral group D5 Cayley table and P
 * the permutation applied per position. The number is valid when the running
 * product ends at 0.
 */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function passesVerhoeff(digits: string): boolean {
  let c = 0;
  // Right to left, position 0 being the check digit itself.
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(reversed[i])]];
  }
  return c === 0;
}

/** Spaces are how people read the number off a card; they carry no meaning. */
export function normalizeAadhaar(raw: string): string {
  return raw.replace(/\s/g, "");
}

/**
 * Twelve digits, not starting 0 or 1 — UIDAI does not issue those — carrying
 * a valid Verhoeff check digit.
 *
 * NOTE FOR TESTING. Cashfree's sandbox reads every image as Aadhaar
 * 123456789012, which this rejects twice over — it starts with 1, and it
 * fails Verhoeff. There is no repair: any number starting 1 is refused
 * whatever its check digit. So the sandbox cannot be walked end to end on
 * this step, because every number it will accept here is one the sandbox OCR
 * then contradicts. That is the same wall OCR_BYPASS already exists for, not
 * a new one — use it to exercise the screens, and a real card plus VRS
 * production credentials for the real path.
 *
 * 234567890124 is a valid number for exercising this validator itself.
 */
export function validateAadhaar(raw: string): { valid: boolean; message?: string } {
  const digits = normalizeAadhaar(raw);

  if (!digits) {
    return { valid: false, message: "Aadhaar number is required" };
  }
  if (!/^\d{12}$/.test(digits)) {
    return { valid: false, message: "Aadhaar number must be 12 digits" };
  }
  if (/^[01]/.test(digits)) {
    return { valid: false, message: "Aadhaar numbers do not start with 0 or 1" };
  }
  if (!passesVerhoeff(digits)) {
    // Deliberately not "invalid Aadhaar" — the number may well be somebody's,
    // just not this person's as typed. A checksum failure is overwhelmingly a
    // typo, so the copy points at the card rather than at the customer.
    return { valid: false, message: "That Aadhaar number looks mistyped. Please check it against the card." };
  }
  return { valid: true };
}

/** Convenience for callers that only want the boolean. */
export function isValidAadhaarNumber(value: string): boolean {
  return validateAadhaar(value).valid;
}

/** Grouped as it is printed on the card, so a mistyped digit is easy to spot. */
export function formatAadhaar(digits: string): string {
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

/**
 * Only the last four are shown back — the same four a masked e-Aadhaar shows,
 * and all the document itself discloses.
 */
export function maskAadhaar(value: string): string {
  return `XXXX XXXX ${value.replace(/\D/g, "").slice(-4)}`;
}
