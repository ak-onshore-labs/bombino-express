/**
 * Which agents hear about a job.
 *
 * There used to be a roster — `listAgentsForPickup` narrowed the fan-out to
 * whoever worked the booked window, on the reasoning that paging the whole
 * field team is how a notification number gets muted. The window went away and
 * took the roster with it, and for a while every agent in the country heard
 * about every job: a Jaipur rider WhatsApped about a Kolkata pickup.
 *
 * Beats are what narrows it now. Ops have always handed riders over with their
 * serviceable pincodes attached; `pickup_beats` is where that finally lives,
 * and `listAgentsForPincode` reads it.
 *
 * The narrowing is advisory in both directions. It decides who is *told*, not
 * who may claim — the available-pickups pool stays global on purpose, so a job
 * in an absent rider's beat is never invisible ("IF ANY PICKUP BOY ABSENT AND
 * LEAVE ADJUST ALL PICKUP BOY"). And when the beats cannot answer, everyone is
 * told. A job nobody hears about is far worse than a notification too many.
 *
 * Internal only: this file names agents and their phone numbers, and nothing
 * here may ever reach a customer-facing response.
 */

import { listAgentIdsForPincode } from "./pickupCoverageDb.js";
import { supabase } from "./supabaseClient.js";
import type { WhatsappRecipient } from "./whatsappDb.js";

function logSupabaseError(
  operation: string,
  error: { message?: string; code?: string } | null
): void {
  console.error("[whatsappAgents] supabase operation failed (non-fatal):", {
    operation,
    message: error?.message,
    code: error?.code,
  });
}

function getSupabaseClient() {
  if (!supabase) {
    console.error("[whatsappAgents] supabase client is not configured");
    return null;
  }
  return supabase;
}

function readOptOut(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>).whatsapp_opt_out === true;
}

async function loadAgents(ids: string[] | null): Promise<WhatsappRecipient[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  let query = client
    .from("itd_users")
    .select("id, full_name, phone, metadata")
    .eq("role", "agent");

  if (ids) {
    if (ids.length === 0) return [];
    query = query.in("id", ids);
  }

  const { data, error } = await query;
  if (error) {
    logSupabaseError("loadAgents", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    full_name: (row.full_name as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    optedOut: readOptOut(row.metadata),
  }));
}

/** One agent, by id, with the opt-out flag the send path needs. */
export async function getAgent(agentId: string): Promise<WhatsappRecipient | null> {
  const agents = await loadAgents([agentId]);
  return agents[0] ?? null;
}

/**
 * Every agent. The morning digest's audience — it walks each agent's own
 * claimed jobs, so it is correctly addressed to all of them.
 */
export async function listAllAgents(): Promise<WhatsappRecipient[]> {
  return loadAgents(null);
}

/**
 * The agents whose beat covers `pincode`, falling back to every agent.
 *
 * The fallback is the important half. It fires when the pincode is missing or
 * malformed, when no active beat covers it, when nobody is assigned to the
 * beats that do, and when the query fails outright — and in every one of those
 * cases the right answer is to tell everybody. Coverage that has not been
 * seeded, a rider not yet added to their round, an address on the edge of the
 * map: none of them should end with a booked pickup that no agent was told
 * about.
 */
export async function listAgentsForPincode(
  pincode: string | null | undefined
): Promise<WhatsappRecipient[]> {
  const ids = await listAgentIdsForPincode(pincode);
  if (ids === null) return loadAgents(null);

  const onBeat = await loadAgents(ids);
  // The ids came from `pickup_beat_agents`, which has a foreign key to
  // itd_users but no check that the row is still an agent. If a demoted or
  // deleted account is all that came back, fall through rather than sending
  // nothing.
  return onBeat.length > 0 ? onBeat : loadAgents(null);
}
