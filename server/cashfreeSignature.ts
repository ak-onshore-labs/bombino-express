/**
 * Cashfree VRS two-factor signature — the alternative to IP whitelisting.
 *
 *   header: x-cf-signature
 *   https://www.cashfree.com/docs/api-reference/vrs/getting-started
 *
 * Production Cashfree refuses a call from an IP that is not whitelisted
 * (403 `ip_validation_failed`). Railway gives no fixed outbound IP without a
 * paid add-on, and every environment would need its own entry. The signature
 * replaces that: `{clientId}.{unix seconds}`, RSA-encrypted with the public key
 * from the Secure ID dashboard (OAEP, SHA-1), base64. Each one is good for five
 * minutes, so it is minted per request.
 *
 * The dashboard must be switched to "Public Key" under Developers >
 * Two-Factor Authentication, or Cashfree keeps checking the IP instead.
 *
 * One env var, optional:
 *
 *   CASHFREE_VRS_PUBLIC_KEY   the .pem Cashfree emails you. Real newlines,
 *                             literal "\n", or just the base64 body all work,
 *                             because pasting a PEM into a dashboard mangles it
 *                             one of those ways.
 *
 * Unset means no header — the IP whitelist path, unchanged. A key that will
 * not load is logged once and treated as unset rather than thrown: Cashfree
 * then answers 403, which the callers already report as unavailable.
 */

import crypto from "crypto";

let cachedSource: string | undefined;
let cachedKey: crypto.KeyObject | null = null;
let badKeyLogged = false;

/** Accepts the three shapes a PEM survives a copy-paste in. Exported for tests. */
export function normalisePublicKeyPem(raw: string): string {
  const text = raw.trim().replace(/\\n/g, "\n");
  if (text.includes("-----BEGIN")) return text;
  const body = text.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

function publicKey(): crypto.KeyObject | null {
  const raw = process.env.CASHFREE_VRS_PUBLIC_KEY?.trim();
  if (!raw) return null;
  if (raw === cachedSource) return cachedKey;

  cachedSource = raw;
  try {
    cachedKey = crypto.createPublicKey(normalisePublicKeyPem(raw));
  } catch (err) {
    cachedKey = null;
    if (!badKeyLogged) {
      badKeyLogged = true;
      console.error(
        "[cashfreeSignature] CASHFREE_VRS_PUBLIC_KEY is not a readable public key — " +
          "sending without a signature:",
        err instanceof Error ? err.message : err
      );
    }
  }
  return cachedKey;
}

/**
 * The `x-cf-signature` header for one request, or nothing when no key is set.
 * Spread it into the request's headers.
 */
export function cashfreeSignatureHeader(
  clientId: string,
  now: Date = new Date()
): Record<string, string> {
  const key = publicKey();
  if (!key) return {};

  const seconds = Math.floor(now.getTime() / 1000);
  const signature = crypto
    .publicEncrypt(
      { key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
      Buffer.from(`${clientId}.${seconds}`, "utf8")
    )
    .toString("base64");

  return { "x-cf-signature": signature };
}
