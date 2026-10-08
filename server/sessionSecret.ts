/**
 * The key that signs every session cookie.
 *
 * In development a fixed fallback is convenient. In production it would mean
 * anyone who has read this repository can forge a session for any user, so
 * the server refuses to start rather than run with it.
 *
 * Its own module so other signers (see `parcelTag.ts`) can derive keys from it
 * without importing the whole app.
 */
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production — refusing to start.");
  }
  return "dev-secret";
}
