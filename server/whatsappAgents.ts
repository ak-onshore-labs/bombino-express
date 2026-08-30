/**
 * Which agents hear about a job.
 *
 * Every agent, now. There used to be a roster — `listAgentsForPickup` narrowed
 * the fan-out to whoever worked the booked window, on the reasoning that
 * paging the whole field team is how a notification number gets muted. The
 * window is gone, and with it the only thing that could narrow the list.
 *
 * Internal only: this file names agents and their phone numbers, and nothing
 * here may ever reach a customer-facing response.
 */

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
 * Every agent.
 *
 * Both audiences now: the morning digest, which iterates each agent's own
 * claimed jobs, and a new pickup entering the pool, which every agent is free
 * to take.
 */
export async function listAllAgents(): Promise<WhatsappRecipient[]> {
  return loadAgents(null);
}
