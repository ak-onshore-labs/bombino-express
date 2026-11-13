/**
 * One shared Postgres pool for the long-lived process.
 *
 * The session store in app.ts keeps its own pool (it starts earlier and owns
 * its lifecycle). Everything else that needs a real SQL transaction — account
 * deletion today — uses this one, created once at first use.
 */

import pg from "pg";
import { assertDatabaseUrl, getPgPoolConfig } from "./pgPoolConfig.js";

let pool: pg.Pool | null | undefined;

/** Shared pool, or null when DATABASE_URL is missing or unusable. */
export function getSharedPgPool(): pg.Pool | null {
  if (pool !== undefined) return pool;
  try {
    assertDatabaseUrl();
  } catch (err) {
    console.warn(
      "[pgPool] DATABASE_URL unusable — transactional paths unavailable:",
      err instanceof Error ? err.message : String(err)
    );
    pool = null;
    return null;
  }
  pool = new pg.Pool(
    getPgPoolConfig({
      max: 3,
      idleTimeoutMillis: 10_000,
    })
  );
  pool.on("error", (err) => {
    console.error("[pgPool] idle client error:", err.message);
  });
  return pool;
}
