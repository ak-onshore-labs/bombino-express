/**
 * Beat administration — the write half of pickup coverage.
 *
 * Reads for the booking path live in `pickupCoverageDb.ts`, which caches the
 * resolved map; this file is the ops console's view, which is per beat, always
 * fresh, and never cached. Every mutation here calls `invalidateCoverage()` so
 * an edit is live on the next booking rather than in five minutes' time.
 *
 * RLS is bypassed (service-role key), so authorisation is entirely the caller's
 * job. Every function here is reachable only from admin-gated routes.
 */

import { invalidateCoverage } from "./pickupCoverageDb.js";
import { supabase } from "./supabaseClient.js";

export type BeatRemark = "ok" | "out_of_city";

export interface BeatPincode {
  pincode: string;
  city: string;
  area: string;
  remark: BeatRemark;
}

export interface BeatSummary {
  id: string;
  slug: string;
  name: string;
  hub: string;
  cutoff_hour: number;
  is_active: boolean;
  pincode_count: number;
  agents: { id: string; full_name: string | null }[];
}

export interface BeatDetail extends BeatSummary {
  pincodes: BeatPincode[];
}

export interface BeatInput {
  slug: string;
  name: string;
  hub: string;
  cutoff_hour: number;
}

export interface BeatPatch {
  name?: string;
  hub?: string;
  cutoff_hour?: number;
  is_active?: boolean;
}

function logSupabaseError(
  operation: string,
  error: { message?: string; code?: string } | null
): void {
  console.error("[beatsDb] supabase operation failed:", {
    operation,
    message: error?.message,
    code: error?.code,
  });
}

function getSupabaseClient() {
  if (!supabase) {
    console.error("[beatsDb] supabase client is not configured");
    return null;
  }
  return supabase;
}

type BeatRow = {
  id: string;
  slug: string;
  name: string;
  hub: string;
  cutoff_hour: number;
  is_active: boolean;
};

type MemberRow = {
  beat_id: string;
  agent_id: string;
  itd_users: { id: string; full_name: string | null } | { id: string; full_name: string | null }[] | null;
};

function firstOf<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/**
 * Beat membership, grouped by beat.
 *
 * One query for every beat rather than one per beat: the list screen shows
 * riders against each row, and eighteen sequential round trips to render a
 * table would be the slowest thing in the console.
 */
async function loadMembers(
  beatIds: string[]
): Promise<Map<string, { id: string; full_name: string | null }[]> | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  if (beatIds.length === 0) return new Map();

  const { data, error } = await client
    .from("pickup_beat_agents")
    .select("beat_id, agent_id, itd_users(id, full_name)")
    .in("beat_id", beatIds);

  if (error) {
    logSupabaseError("loadMembers", error);
    return null;
  }

  const byBeat = new Map<string, { id: string; full_name: string | null }[]>();
  for (const row of (data ?? []) as unknown as MemberRow[]) {
    const user = firstOf(row.itd_users);
    const entry = { id: row.agent_id, full_name: user?.full_name ?? null };
    const at = byBeat.get(row.beat_id);
    if (at) at.push(entry);
    else byBeat.set(row.beat_id, [entry]);
  }
  return byBeat;
}

/** Pincode counts per beat, without pulling ~700 rows to render a table. */
async function loadCounts(beatIds: string[]): Promise<Map<string, number> | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  if (beatIds.length === 0) return new Map();

  // `head: true` with an exact count returns the number and no rows, per beat.
  const counts = new Map<string, number>();
  for (const beatId of beatIds) {
    const { count, error } = await client
      .from("pickup_beat_pincodes")
      .select("pincode", { count: "exact", head: true })
      .eq("beat_id", beatId);

    if (error) {
      logSupabaseError("loadCounts", error);
      return null;
    }
    counts.set(beatId, count ?? 0);
  }
  return counts;
}

/** Every beat, retired ones included — ops need to see what they turned off. */
export async function listBeats(): Promise<BeatSummary[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("pickup_beats")
    .select("id, slug, name, hub, cutoff_hour, is_active")
    .order("hub", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    logSupabaseError("listBeats", error);
    return null;
  }

  const beats = (data ?? []) as BeatRow[];
  const ids = beats.map((b) => b.id);
  const [members, counts] = await Promise.all([loadMembers(ids), loadCounts(ids)]);
  if (!members || !counts) return null;

  return beats.map((beat) => ({
    ...beat,
    pincode_count: counts.get(beat.id) ?? 0,
    agents: members.get(beat.id) ?? [],
  }));
}

/** One beat with its full pincode list. */
export async function getBeat(id: string): Promise<BeatDetail | null | "missing"> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("pickup_beats")
    .select("id, slug, name, hub, cutoff_hour, is_active")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logSupabaseError("getBeat", error);
    return null;
  }
  if (!data) return "missing";

  const beat = data as BeatRow;

  const { data: pins, error: pinsError } = await client
    .from("pickup_beat_pincodes")
    .select("pincode, city, area, remark")
    .eq("beat_id", id)
    .order("pincode", { ascending: true });

  if (pinsError) {
    logSupabaseError("getBeat/pincodes", pinsError);
    return null;
  }

  const members = await loadMembers([id]);
  if (!members) return null;

  return {
    ...beat,
    pincodes: (pins ?? []) as BeatPincode[],
    agents: members.get(id) ?? [],
    pincode_count: (pins ?? []).length,
  };
}

/** Returns `"taken"` on the slug unique violation so a duplicate is a 409. */
export async function insertBeat(input: BeatInput): Promise<BeatRow | "taken" | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("pickup_beats")
    .insert(input)
    .select("id, slug, name, hub, cutoff_hour, is_active")
    .single();

  if (error) {
    if (error.code === "23505") return "taken";
    logSupabaseError("insertBeat", error);
    return null;
  }

  invalidateCoverage();
  return data as BeatRow;
}

export async function updateBeat(
  id: string,
  patch: BeatPatch
): Promise<BeatRow | "missing" | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("pickup_beats")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, slug, name, hub, cutoff_hour, is_active")
    .maybeSingle();

  if (error) {
    logSupabaseError("updateBeat", error);
    return null;
  }
  if (!data) return "missing";

  invalidateCoverage();
  return data as BeatRow;
}

/**
 * Replace a beat's pincodes wholesale.
 *
 * Replace rather than edit, because that is the shape of the hand-over: ops are
 * sent a list and paste a list. Per-row editing would invent a workflow nobody
 * has, and would leave no way to express "this code is no longer on the round"
 * short of hunting for it.
 *
 * Delete-then-insert is not atomic here — Supabase's REST client has no
 * transaction — so a failed insert after a successful delete empties the beat.
 * That is survivable and visible: the beat reads as zero pincodes in the
 * console, and the fix is to paste the list again. The alternative, holding
 * both sets live at once, would need a staging table for a screen ops touch a
 * few times a year.
 */
export async function replaceBeatPincodes(
  beatId: string,
  pincodes: readonly BeatPincode[]
): Promise<number | "missing" | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data: beat, error: beatError } = await client
    .from("pickup_beats")
    .select("id")
    .eq("id", beatId)
    .maybeSingle();

  if (beatError) {
    logSupabaseError("replaceBeatPincodes/beat", beatError);
    return null;
  }
  if (!beat) return "missing";

  const { error: deleteError } = await client
    .from("pickup_beat_pincodes")
    .delete()
    .eq("beat_id", beatId);

  if (deleteError) {
    logSupabaseError("replaceBeatPincodes/delete", deleteError);
    return null;
  }

  if (pincodes.length > 0) {
    const { error: insertError } = await client
      .from("pickup_beat_pincodes")
      .insert(pincodes.map((p) => ({ ...p, beat_id: beatId })));

    if (insertError) {
      logSupabaseError("replaceBeatPincodes/insert", insertError);
      return null;
    }
  }

  invalidateCoverage();
  return pincodes.length;
}

/**
 * Replace a beat's riders.
 *
 * Coverage does not depend on membership — a beat with nobody on it still makes
 * its pincodes serviceable — so this does not invalidate the coverage cache.
 * It only changes who gets notified, which is read fresh on every booking.
 */
export async function replaceBeatAgents(
  beatId: string,
  agentIds: readonly string[]
): Promise<number | "missing" | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data: beat, error: beatError } = await client
    .from("pickup_beats")
    .select("id")
    .eq("id", beatId)
    .maybeSingle();

  if (beatError) {
    logSupabaseError("replaceBeatAgents/beat", beatError);
    return null;
  }
  if (!beat) return "missing";

  const { error: deleteError } = await client
    .from("pickup_beat_agents")
    .delete()
    .eq("beat_id", beatId);

  if (deleteError) {
    logSupabaseError("replaceBeatAgents/delete", deleteError);
    return null;
  }

  if (agentIds.length > 0) {
    const { error: insertError } = await client
      .from("pickup_beat_agents")
      .insert(agentIds.map((agent_id) => ({ beat_id: beatId, agent_id })));

    if (insertError) {
      logSupabaseError("replaceBeatAgents/insert", insertError);
      return null;
    }
  }

  return agentIds.length;
}

/**
 * Which beats each of these agents runs, for the staff list.
 *
 * Names only, and only what the ops console already shows elsewhere.
 */
export async function beatNamesByAgent(
  agentIds: readonly string[]
): Promise<Map<string, string[]> | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  if (agentIds.length === 0) return new Map();

  const { data, error } = await client
    .from("pickup_beat_agents")
    .select("agent_id, pickup_beats(name)")
    .in("agent_id", agentIds as string[]);

  if (error) {
    logSupabaseError("beatNamesByAgent", error);
    return null;
  }

  const byAgent = new Map<string, string[]>();
  for (const row of (data ?? []) as unknown as {
    agent_id: string;
    pickup_beats: { name: string } | { name: string }[] | null;
  }[]) {
    const beat = firstOf(row.pickup_beats);
    if (!beat) continue;
    const at = byAgent.get(row.agent_id);
    if (at) at.push(beat.name);
    else byAgent.set(row.agent_id, [beat.name]);
  }
  return byAgent;
}
