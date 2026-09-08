/**
 * Pickup coverage, read from the beat tables.
 *
 * The database is authority: ops edit beats at /ops/beats and the change is
 * live without a deploy. `shared/pickupPincodes.ts` is the floor beneath it —
 * the same rows, compiled in, seeded from the same array — and every function
 * here falls back to it rather than failing. That is deliberate and load
 * bearing: a pincode lookup sits between a customer and a booking, and the
 * honest failure mode is slightly stale coverage, never a booking that cannot
 * be made because Supabase was slow.
 *
 * Both sides resolve through `buildCoverage`, so a fallback answer differs from
 * a live one only in which rows it holds, never in how they were read.
 *
 * CACHING. The whole map is built at once and held for five minutes. It is
 * ~700 rows and every booking asks for it, so a query per request would be
 * absurd; and ops writes call `invalidateCoverage()`, so an edit is visible on
 * the next request rather than in five minutes' time. The TTL only covers
 * changes made outside this process — another instance, or psql.
 */

import { supabase } from "./supabaseClient.js";
import {
  STATIC_COVERAGE,
  buildCoverage,
  type CoverageRow,
  type PickupArea,
  type PickupRemark,
} from "../shared/pickupPincodes.js";

export type CoverageSource = "db" | "static";

export interface Coverage {
  areas: ReadonlyMap<string, PickupArea>;
  source: CoverageSource;
}

/** Supabase caps a select at 1,000 rows; coverage will outgrow that. */
const PAGE_SIZE = 1000;

const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: { coverage: Coverage; at: number } | null = null;

function logSupabaseError(
  operation: string,
  error: { message?: string; code?: string } | null
): void {
  console.error("[pickupCoverageDb] supabase operation failed:", {
    operation,
    message: error?.message,
    code: error?.code,
  });
}

function getSupabaseClient() {
  if (!supabase) {
    console.error("[pickupCoverageDb] supabase client is not configured");
    return null;
  }
  return supabase;
}

/** The shape the embed returns: a pincode row with its beat's cutoff attached. */
type PincodeRow = {
  pincode: string;
  city: string;
  area: string;
  remark: string;
  pickup_beats: { cutoff_hour: number } | { cutoff_hour: number }[] | null;
};

/**
 * `!inner` on the embed is what applies `is_active` as a join condition rather
 * than a post-filter — without it a retired beat's pincodes come back with a
 * null beat attached and quietly widen coverage.
 */
const PINCODE_SELECT = "pincode, city, area, remark, pickup_beats!inner(cutoff_hour, is_active)";

function cutoffOf(row: PincodeRow): number | null {
  const beat = Array.isArray(row.pickup_beats) ? row.pickup_beats[0] : row.pickup_beats;
  return typeof beat?.cutoff_hour === "number" ? beat.cutoff_hour : null;
}

/**
 * Every active beat's rows, flat and unreconciled — several per pincode where
 * beats overlap, which is exactly what `buildCoverage` expects.
 *
 * Returns null on any DB error, which every caller reads as "use the static
 * table". An empty table is NOT an error and returns `[]`; the caller decides
 * that unseeded means fall back, because zero coverage would otherwise refuse
 * every pickup in the country.
 */
async function loadCoverageRows(): Promise<CoverageRow[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const rows: CoverageRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from("pickup_beat_pincodes")
      .select(PINCODE_SELECT)
      .eq("pickup_beats.is_active", true)
      .order("pincode", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      logSupabaseError("loadCoverageRows", error);
      return null;
    }

    const page = (data ?? []) as unknown as PincodeRow[];
    for (const row of page) {
      const cutoffHour = cutoffOf(row);
      // A row whose beat did not come back is a broken join, not a pincode we
      // are willing to promise a rider for.
      if (cutoffHour === null) continue;
      rows.push({
        pincode: row.pincode,
        city: row.city,
        area: row.area,
        remark: row.remark === "out_of_city" ? "out_of_city" : ("ok" as PickupRemark),
        cutoffHour,
      });
    }

    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

/** Drop the cache so the next read sees an ops edit. Called by every beat write. */
export function invalidateCoverage(): void {
  cached = null;
}

/**
 * The coverage map to answer with, and where it came from.
 *
 * `source` is not decoration: it is the difference between "we are serving what
 * ops last edited" and "we are serving what was compiled in weeks ago", and it
 * rides all the way out to `GET /api/pickup/coverage` so that difference is
 * visible from a browser during an incident.
 */
export async function getCoverage(): Promise<Coverage> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.coverage;
  }

  const rows = await loadCoverageRows();

  // Unseeded is treated exactly like unreachable. Both mean the database has
  // nothing to say, and the static table is what it would have said.
  const coverage: Coverage =
    rows && rows.length > 0
      ? { areas: buildCoverage(rows), source: "db" }
      : { areas: STATIC_COVERAGE, source: "static" };

  cached = { coverage, at: Date.now() };
  return coverage;
}

/**
 * The agents on every active beat covering `pincode`.
 *
 * Two queries rather than a nested embed: the join runs beat_pincodes → beats
 * → beat_agents, and expressing that as one Supabase embed is less legible than
 * it is fast. Both are index hits on a table of a few hundred rows.
 *
 * Returns null — not `[]` — when the answer is unknown (no client, a DB error,
 * or the tables are unseeded), because the caller's fallback for "unknown" is
 * to notify everyone, and its response to "nobody" must be the same. An agent
 * who is on no beat should not mean a job nobody hears about.
 */
export async function listAgentIdsForPincode(
  pincode: string | null | undefined
): Promise<string[] | null> {
  const code = (pincode ?? "").trim();
  if (!/^[0-9]{6}$/.test(code)) return null;

  const client = getSupabaseClient();
  if (!client) return null;

  const { data: beats, error: beatsError } = await client
    .from("pickup_beat_pincodes")
    .select("beat_id, pickup_beats!inner(is_active)")
    .eq("pincode", code)
    .eq("pickup_beats.is_active", true);

  if (beatsError) {
    logSupabaseError("listAgentIdsForPincode/beats", beatsError);
    return null;
  }

  const beatIds = (beats ?? []).map((row) => (row as { beat_id: string }).beat_id);
  if (beatIds.length === 0) return null;

  const { data: members, error: membersError } = await client
    .from("pickup_beat_agents")
    .select("agent_id")
    .in("beat_id", beatIds);

  if (membersError) {
    logSupabaseError("listAgentIdsForPincode/agents", membersError);
    return null;
  }

  const ids = (members ?? []).map((row) => (row as { agent_id: string }).agent_id);
  if (ids.length === 0) return null;

  // A rider can run more than one beat covering the same pincode.
  const seen: Record<string, true> = {};
  const unique: string[] = [];
  for (const id of ids) {
    if (seen[id]) continue;
    seen[id] = true;
    unique.push(id);
  }
  return unique;
}
