/**
 * Parcel tags: the token behind the QR on a guest's box label.
 *
 * A guest order has no AWB until ops dockets it at the hub, so the box goes out
 * with a QR instead. The QR opens `/p/<token>`, a view-only page anyone can
 * read. The token is `<orderId>.<sig>`: the order's uuid plus an HMAC of it, so
 * it is stateless (no table, no migration) and cannot be guessed or walked
 * through the way sequential BOM numbers could.
 *
 * The key is derived from the session secret rather than being a new variable;
 * the label string versions it, so rotating tags means bumping `v1`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "./sessionSecret.js";

const SIG_BYTES = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tagKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("parcel-tag-v1").digest();
}

function sign(orderId: string, secret: string): Buffer {
  return createHmac("sha256", tagKey(secret)).update(orderId.toLowerCase()).digest().subarray(0, SIG_BYTES);
}

export function parcelTagFor(orderId: string, secret: string = sessionSecret()): string {
  return `${orderId.toLowerCase()}.${sign(orderId, secret).toString("base64url")}`;
}

/** The order id a tag names, or null when it is malformed or forged. */
export function verifyParcelTag(token: string, secret: string = sessionSecret()): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const orderId = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  if (!UUID.test(orderId) || !/^[A-Za-z0-9_-]+$/.test(sigPart)) return null;

  const given = Buffer.from(sigPart, "base64url");
  if (given.length !== SIG_BYTES) return null;
  // 16 bytes is 22 base64 characters, and the last one has 4 bits the decoder
  // ignores, so several spellings decode alike. Only the canonical one counts:
  // one parcel, one URL.
  if (given.toString("base64url") !== sigPart) return null;
  const expected = sign(orderId, secret);
  return timingSafeEqual(given, expected) ? orderId.toLowerCase() : null;
}

/** The path the QR points at, relative to the app's own origin. */
export function parcelTagPath(orderId: string): string {
  return `/p/${parcelTagFor(orderId)}`;
}
