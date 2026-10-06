/**
 * Which agents ops can pick for a pickup: the ones in the pickup's city.
 *
 * The pickup's city comes from the sender's PIN code — the beats that collect
 * there, and their hub — falling back to the sender's city as typed. 400601
 * (Thane) is collected by Andheri beats, so it reads as Mumbai, which is where
 * the riders who can reach it are.
 *
 * An agent is in a city through either of two links:
 *   - the hub they were created with (`metadata.hub_id`), or
 *   - the hub of any beat they ride.
 * Mumbai's offices (Mumbai, Fort, Lower Parel, Andheri) count as one city, see
 * `hubCity` in shared/hubs.ts.
 *
 * When the city is unknown, or nobody is set up there yet, every active agent
 * is listed with `scoped: false`, so a pickup is never left with no one to
 * assign. Display only: POST /api/ops/orders/:id/assign does not enforce it.
 */

import { hubCity, hubCityForId } from "../shared/hubs.js";
import { listBeatsForPincode } from "./beatsDb.js";
import { dbClient, logDbError, type DbError } from "./db/client.js";

export interface AgentOption {
  id: string;
  full_name: string;
  phone: string | null;
}

export interface AgentWithCities extends AgentOption {
  cities: string[];
}

export interface AssignableAgents {
  /** The pickup's city, or null when it can't be told. */
  city: string | null;
  /** False when the list is every active agent rather than the city's. */
  scoped: boolean;
  agents: AgentOption[];
}

const logSupabaseError = (operation: string, error: DbError): void =>
  logDbError("assignableAgents", operation, error);

const getSupabaseClient = () => dbClient("assignableAgents");

function byName(a: AgentOption, b: AgentOption): number {
  return a.full_name.localeCompare(b.full_name);
}

function strip({ id, full_name, phone }: AgentWithCities): AgentOption {
  return { id, full_name, phone };
}

/** Pure: the city's agents, or everyone when the city has none. */
export function pickAgentsForCity(agents: readonly AgentWithCities[], city: string | null): AssignableAgents {
  const all = agents.map(strip).sort(byName);
  if (!city) return { city: null, scoped: false, agents: all };
  const inCity = agents.filter((a) => a.cities.includes(city)).map(strip).sort(byName);
  return inCity.length > 0 ? { city, scoped: true, agents: inCity } : { city, scoped: false, agents: all };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

/** The pickup's city, from the sender's PIN code first and their typed city second. */
export async function pickupCity(items: unknown): Promise<string | null> {
  const p = (items && typeof items === "object" ? items : {}) as Record<string, unknown>;
  const pincode = str(p.shipper_zip_code);
  if (/^\d{6}$/.test(pincode)) {
    const beats = await listBeatsForPincode(pincode);
    const fromBeat = beats?.map((b) => hubCity(b.hub)).find((c): c is string => !!c);
    if (fromBeat) return fromBeat;
  }
  return hubCity(str(p.shipper_city));
}

function firstOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/** Every active agent with the cities they're linked to. `null` on a DB miss. */
export async function loadAgentsWithCities(): Promise<AgentWithCities[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const [users, beats] = await Promise.all([
    client.from("itd_users").select("id, full_name, phone, metadata").eq("role", "agent").eq("is_active", true),
    client.from("pickup_beat_agents").select("agent_id, pickup_beats(hub)"),
  ]);
  if (users.error) {
    logSupabaseError("loadAgentsWithCities users", users.error);
    return null;
  }
  if (beats.error) {
    // Beat links are the second source; the hub on the account still answers.
    logSupabaseError("loadAgentsWithCities beats", beats.error);
  }

  const beatCities = new Map<string, Set<string>>();
  for (const row of (beats.data ?? []) as unknown as {
    agent_id: string;
    pickup_beats: { hub: string } | { hub: string }[] | null;
  }[]) {
    const city = hubCity(firstOf(row.pickup_beats)?.hub);
    if (!city) continue;
    const set = beatCities.get(row.agent_id) ?? new Set<string>();
    set.add(city);
    beatCities.set(row.agent_id, set);
  }

  return (users.data ?? []).map((row) => {
    const id = String(row.id);
    const metadata = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
    const cities = new Set(beatCities.get(id) ?? []);
    const own = hubCityForId(metadata.hub_id);
    if (own) cities.add(own);
    return {
      id,
      full_name: String(row.full_name ?? ""),
      phone: typeof row.phone === "string" ? row.phone : null,
      cities: [...cities],
    };
  });
}
