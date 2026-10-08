/**
 * Parcel IDs: the 12-character ID printed on our QR box label, and carried in
 * the QR itself (`/p/<id>`).
 *
 * Made once per order, the first time its label is made, and kept on the
 * order (`orders.metadata.parcel_id`) so every reprint carries the same ID.
 * Random, not derived: it must not change between environments or secrets.
 *
 * The alphabet leaves out 0/O and 1/I/L, so an ID read off a box and typed in
 * cannot be mistyped between lookalikes. 31 symbols over 12 places is ~59
 * bits: not guessable, so the public page needs no signature on top.
 *
 * Every ID contains a letter, so a scanned ID is never confused with an AWB
 * (digits only).
 */

import { randomInt } from "node:crypto";

export const PARCEL_ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const PARCEL_ID_LENGTH = 12;

export function newParcelId(): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < PARCEL_ID_LENGTH; i++) {
      id += PARCEL_ID_ALPHABET[randomInt(PARCEL_ID_ALPHABET.length)];
    }
    if (/[A-Z]/.test(id)) return id;
  }
}

/**
 * The canonical form of whatever was scanned or typed: spaces and dashes
 * dropped, upper case, and the lookalikes folded onto what they must have
 * meant. Null when it cannot be a parcel ID.
 */
export function normaliseParcelId(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  // After folding, 0 and 1 are the only symbols outside the alphabet; an ID
  // containing them was mistyped beyond repair.
  if (s.length !== PARCEL_ID_LENGTH) return null;
  for (const ch of s) if (!PARCEL_ID_ALPHABET.includes(ch)) return null;
  return /[A-Z]/.test(s) ? s : null;
}

/** "7KQ2MX9P4HTR" -> "7KQ2-MX9P-4HTR", for printing and showing. */
export function formatParcelId(id: string): string {
  return id.match(/.{1,4}/g)?.join("-") ?? id;
}
