/**
 * The Supabase client and its error log, once instead of eleven times.
 *
 * Every `*Db` module had its own private pair of these, identical but for the
 * `[module]` prefix — so adding structured logging, or a Sentry breadcrumb, or
 * a retry, meant eleven edits and eleven chances to miss one. The modules now
 * keep a two-line local alias each, so their call sites read exactly as before.
 *
 * `dbClient` returns null rather than throwing: a data layer that cannot reach
 * the database answers "no rows" and lets the route decide what that means to
 * the customer, which is the contract every caller here already relies on.
 */

import { supabase } from "../supabaseClient.js";

export type DbError = { message?: string; code?: string } | null;

export function dbClient(module: string): NonNullable<typeof supabase> | null {
  if (!supabase) {
    console.error(`[${module}] supabase client is not configured`);
    return null;
  }
  return supabase;
}

export function logDbError(module: string, operation: string, error: DbError): void {
  console.error(`[${module}] supabase operation failed:`, {
    operation,
    message: error?.message,
    code: error?.code,
  });
}
