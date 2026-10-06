/**
 * A branch manager's city, applied to orders.
 *
 * An order's city is its pickup city, worked out the same way as the Assign to
 * agent picker (`pickupCity` in assignableAgents.ts): the hub of the beats that
 * collect at the sender's PIN code, else the sender's typed city. This is the
 * bulk form, for filtering a board of orders in two queries rather than one per
 * order.
 *
 * Only branch managers are filtered; every other ops role sees every city. See
 * shared/staffAccess.ts.
 */

import type { Request } from "express";
import { hubCity } from "../shared/hubs.js";
import { pickupCity } from "./assignableAgents.js";
import { dbClient, logDbError } from "./db/client.js";

const getSupabaseClient = () => dbClient("staffScope");

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function firstOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/** True when the caller sees only one city's orders, agents and beats. */
export function isScoped(req: Request): boolean {
  return req.staff?.scoped === true;
}

/** The pickup city of each order id. Null on a DB miss. */
async function citiesOfOrders(ids: readonly string[]): Promise<Map<string, string | null> | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const out = new Map<string, string | null>();
  if (ids.length === 0) return out;

  const items = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await client.from("orders").select("id, items").in("id", ids.slice(i, i + 200));
    if (error) {
      logDbError("staffScope", "citiesOfOrders orders", error);
      return null;
    }
    for (const row of data ?? []) {
      const value = row.items && typeof row.items === "object" ? (row.items as Record<string, unknown>) : {};
      items.set(String(row.id), value);
    }
  }

  const pincodes = [
    ...new Set([...items.values()].map((p) => str(p.shipper_zip_code)).filter((p) => /^\d{6}$/.test(p))),
  ];
  const pincodeCity = new Map<string, string>();
  for (let i = 0; i < pincodes.length; i += 200) {
    const { data, error } = await client
      .from("pickup_beat_pincodes")
      .select("pincode, pickup_beats!inner(hub, is_active)")
      .in("pincode", pincodes.slice(i, i + 200))
      .eq("pickup_beats.is_active", true);
    if (error) {
      logDbError("staffScope", "citiesOfOrders beats", error);
      return null;
    }
    for (const row of (data ?? []) as unknown as {
      pincode: string;
      pickup_beats: { hub: string } | { hub: string }[] | null;
    }[]) {
      const city = hubCity(firstOf(row.pickup_beats)?.hub);
      if (city && !pincodeCity.has(row.pincode)) pincodeCity.set(row.pincode, city);
    }
  }

  for (const id of ids) {
    const p = items.get(id) ?? {};
    out.set(id, pincodeCity.get(str(p.shipper_zip_code)) ?? hubCity(str(p.shipper_city)));
  }
  return out;
}

/**
 * The rows the caller may see. Unscoped callers get them all back unchanged.
 * A branch manager with no city on their account sees nothing.
 */
export async function keepCallersOrders<T extends { id: string }>(req: Request, rows: T[]): Promise<T[] | null> {
  if (!isScoped(req)) return rows;
  const city = req.staff?.city ?? null;
  if (!city) return [];
  const cities = await citiesOfOrders(rows.map((r) => r.id));
  if (!cities) return null;
  return rows.filter((r) => cities.get(r.id) === city);
}

/** Whether the caller may see or act on this order. Unscoped callers always may. */
export async function isCallersOrder(req: Request, order: { items: unknown }): Promise<boolean> {
  if (!isScoped(req)) return true;
  const city = req.staff?.city ?? null;
  if (!city) return false;
  return (await pickupCity(order.items)) === city;
}
