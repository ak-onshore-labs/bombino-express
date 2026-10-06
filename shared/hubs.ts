/**
 * India hub list for corporate ITD add_customer.
 *
 * Single source for the company-signup picker and server-side validation.
 * Membership check only — ids are not a contiguous range (13–22 are unused).
 */

export const INDIA_HUBS = [
  { id: 1, name: "Mumbai" },
  { id: 2, name: "Hyderabad" },
  { id: 3, name: "Delhi" },
  { id: 4, name: "Chandigarh" },
  { id: 5, name: "Ahmedabad" },
  { id: 6, name: "Bangalore" },
  { id: 7, name: "Pune" },
  { id: 8, name: "Fort Office" },
  { id: 9, name: "Jaipur" },
  { id: 10, name: "Chennai" },
  { id: 11, name: "Kolkata" },
  { id: 12, name: "Lower Parel" },
  { id: 23, name: "Surat" },
] as const;

export type IndiaHubId = (typeof INDIA_HUBS)[number]["id"];

export function isIndiaHubId(value: number): value is IndiaHubId {
  return INDIA_HUBS.some((h) => h.id === value);
}

/**
 * The city a hub or beat hub belongs to, for grouping agents by city.
 *
 * Mumbai runs out of several offices: the Mumbai, Fort Office and Lower Parel
 * hubs, and beats whose hub is "Fort" or "Mumbai (Andheri)". They are one city
 * when ops pick an agent for a pickup. Everything else is its own name.
 */
const MUMBAI_HUBS = new Set(["mumbai", "fort", "fort office", "lower parel", "andheri", "mumbai (andheri)"]);

export function hubCity(name: string | null | undefined): string | null {
  const key = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  if (MUMBAI_HUBS.has(key) || key.startsWith("mumbai")) return "Mumbai";
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** `hubCity` for an India hub id, as staff carry it in `metadata.hub_id`. */
export function hubCityForId(id: unknown): string | null {
  const n = Number(id);
  const hub = INDIA_HUBS.find((h) => h.id === n);
  return hub ? hubCity(hub.name) : null;
}
