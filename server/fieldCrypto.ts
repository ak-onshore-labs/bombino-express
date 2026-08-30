/**
 * Encryption at rest for the fields that carry identity.
 *
 * The document images and the numbers off them — Aadhaar, PAN, GSTIN — sat in
 * Postgres as plaintext (docs/kyc-retention.md, "unencrypted at rest"). Anything
 * with read access to the database, a backup, or a support console could read a
 * customer's Aadhaar card. Under the DPDP Act those are personal data a Data
 * Fiduciary has to protect with reasonable security safeguards; in practice
 * this is the difference between a leaked backup being an incident and being a
 * catastrophe.
 *
 * WHY NOT server/crypto.ts. That module exists and does correct AES-256-GCM,
 * but it FAILS OPEN — with no key it returns `{ encrypted: "", iv: "" }` and
 * the caller writes an empty string. For an ITD password that is a recoverable
 * annoyance; for an Aadhaar image it would mean silently storing the document
 * in the clear, which is exactly the outcome this file exists to prevent. So
 * everything here throws instead, and the callers let it.
 *
 * ENVELOPE FORMAT
 *
 *   enc:v1:<iv base64>:<ciphertext+authTag base64>
 *
 * Self-describing on purpose. Rows written before this existed are plaintext
 * with no prefix, and there is no flag day: `decryptField` returns anything
 * unprefixed unchanged, so old and new rows coexist while the backfill runs
 * (scripts/encrypt-existing-documents.ts). Once nothing unprefixed is left,
 * `assertAllEncrypted` in that script is what proves it rather than assuming.
 *
 * The IV is random per call — never derived, never reused — and GCM's auth tag
 * means a tampered ciphertext throws rather than decrypting to rubbish.
 *
 * KEY. The same ENCRYPTION_KEY the password helper uses: 64 hex characters,
 * 32 bytes. One key for now, which is why the envelope carries a version — a
 * second key means `v2` and a re-encrypt, not a guess about which key wrote a
 * given row. Rotating it without re-encrypting makes every document
 * unreadable, so it is not a value to change casually.
 */

import nodeCrypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_HEX_CHARS = 64;

/** Marks a value this module wrote. Anything else is legacy plaintext. */
const PREFIX = "enc:v1:";

function loadKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length !== KEY_HEX_CHARS) return null;
  const buf = Buffer.from(raw, "hex");
  return buf.length === 32 ? buf : null;
}

export function isFieldCryptoConfigured(): boolean {
  return loadKey() !== null;
}

/**
 * Refuse to run at all without a key.
 *
 * Called at boot so a misconfigured deploy dies on startup rather than at the
 * first upload — the failure mode this replaces was noticing months later that
 * a column was full of plaintext.
 */
export function assertFieldCryptoConfigured(): void {
  if (isFieldCryptoConfigured()) return;
  throw new Error(
    "ENCRYPTION_KEY is missing or invalid (expected 64 hex characters). " +
      "Identity documents cannot be stored without it. Generate one with: " +
      "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
}

/** True when this value was written by encryptField. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Encrypt one field. Throws rather than returning plaintext or an empty
 * string, so a caller cannot accidentally persist an unprotected document.
 */
export function encryptField(plaintext: string): string {
  const key = loadKey();
  if (!key) {
    throw new Error("ENCRYPTION_KEY not configured; refusing to store identity data unencrypted");
  }
  // Already encrypted: return as-is so a re-save cannot double-wrap a value
  // and make it undecryptable in one pass.
  if (isEncrypted(plaintext)) return plaintext;

  const iv = nodeCrypto.randomBytes(IV_LENGTH);
  const cipher = nodeCrypto.createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const packed = Buffer.concat([body, cipher.getAuthTag()]);
  return `${PREFIX}${iv.toString("base64")}:${packed.toString("base64")}`;
}

/**
 * Decrypt one field.
 *
 * A value with no prefix predates encryption and is returned unchanged — that
 * is what lets the backfill run against a live database instead of needing a
 * flag day. It is also why the backfill has to finish: this cannot tell a
 * legacy row from one that failed to encrypt.
 */
export function decryptField(stored: string): string {
  if (!isEncrypted(stored)) return stored;

  const key = loadKey();
  if (!key) {
    throw new Error("ENCRYPTION_KEY not configured; stored identity data cannot be read");
  }

  const [ivB64, packedB64] = stored.slice(PREFIX.length).split(":");
  if (!ivB64 || !packedB64) throw new Error("Malformed encrypted field");

  const packed = Buffer.from(packedB64, "base64");
  if (packed.length <= AUTH_TAG_LENGTH) throw new Error("Encrypted field is too short");

  const decipher = nodeCrypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(packed.subarray(packed.length - AUTH_TAG_LENGTH));
  return Buffer.concat([
    decipher.update(packed.subarray(0, packed.length - AUTH_TAG_LENGTH)),
    decipher.final(),
  ]).toString("utf8");
}

/** Nullable convenience — `document_no` is optional on some slots. */
export function encryptNullable(value: string | null): string | null {
  return value === null || value === "" ? value : encryptField(value);
}

export function decryptNullable(value: string | null): string | null {
  return value === null || value === "" ? value : decryptField(value);
}
