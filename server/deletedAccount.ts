/**
 * Whether an itd_users row has been self-deleted.
 *
 * Fail-open: a database hiccup must never sign every customer out. Only a
 * confirmed `metadata.deleted_at` returns true. Results are cached briefly so
 * requireUser on a busy screen does not hit Postgres on every request.
 */

import { supabase } from "./supabaseClient.js";

const CACHE_TTL_MS = 30_000;

type CacheEntry = { deleted: boolean; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function readDeletedAt(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).deleted_at;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** True only when the row is confirmed deleted. Errors and missing DB → false. */
export async function isUserDeleted(userId: string): Promise<boolean> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > now) return hit.deleted;

  if (!supabase) {
    console.warn("[deletedAccount] supabase unconfigured — treating as not deleted");
    return false;
  }

  try {
    const { data, error } = await supabase
      .from("itd_users")
      .select("metadata")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.warn("[deletedAccount] lookup failed (fail-open):", error.message);
      return false;
    }
    if (!data) {
      cache.set(userId, { deleted: false, expiresAt: now + CACHE_TTL_MS });
      return false;
    }

    const deleted = readDeletedAt(data.metadata) !== null;
    cache.set(userId, { deleted, expiresAt: now + CACHE_TTL_MS });
    return deleted;
  } catch (err) {
    console.warn(
      "[deletedAccount] lookup threw (fail-open):",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

/** Drop a cached answer after a deletion so the next request sees it. */
export function invalidateDeletedCache(userId: string): void {
  cache.delete(userId);
}

/** True when this metadata bag marks a deleted account. */
export function metadataSaysDeleted(metadata: unknown): boolean {
  return readDeletedAt(metadata) !== null;
}
