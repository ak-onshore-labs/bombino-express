const INDIA_PINCODE_URL = "https://api.postalpincode.in/pincode";
const ZIPPOTAM_BASE_URL = "https://api.zippopotam.us";
const UPSTREAM_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 5000;

export interface PostalLookupResult {
  found: boolean;
  city: string;
  state: string;
}

const NOT_FOUND: PostalLookupResult = { found: false, city: "", state: "" };

interface IndiaPostOffice {
  District?: string;
  State?: string;
}

interface IndiaPostalResponse {
  Status?: string;
  PostOffice?: IndiaPostOffice[];
}

interface ZippopotamPlace {
  "place name"?: string;
  "state abbreviation"?: string;
  state?: string;
}

interface ZippopotamResponse {
  places?: ZippopotamPlace[];
}

function cacheKey(country: string, code: string): string {
  return `postal:${country}:${code}`;
}

/**
 * A bounded TTL cache held in this process. It only saves repeat calls to the
 * public postal APIs, so losing it on a restart costs one upstream call per
 * pincode — not worth a Redis instance. Map iteration order is insertion
 * order, so the first key is the oldest and is the one evicted at the cap.
 */
export class TtlCache<V> {
  private entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number
  ) {}

  get(key: string, now = Date.now()): V | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    return hit.value;
  }

  set(key: string, value: V, now = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  size(): number {
    return this.entries.size;
  }
}

const cache = new TtlCache<PostalLookupResult>(CACHE_TTL_MS, CACHE_MAX_ENTRIES);

async function readCache(key: string): Promise<PostalLookupResult | null> {
  return cache.get(key);
}

async function writeCache(key: string, result: PostalLookupResult): Promise<void> {
  if (!result.found) return;
  cache.set(key, result);
}

async function fetchIndiaFromUpstream(code: string): Promise<PostalLookupResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(`${INDIA_PINCODE_URL}/${code}`, {
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[postalLookup] upstream HTTP ${res.status}`);
      return NOT_FOUND;
    }

    const body = (await res.json()) as IndiaPostalResponse[];
    const first = body?.[0];
    if (
      first?.Status !== "Success" ||
      !Array.isArray(first.PostOffice) ||
      first.PostOffice.length === 0
    ) {
      return NOT_FOUND;
    }

    const office = first.PostOffice[0];
    const city = office.District?.trim() ?? "";
    const state = office.State?.trim() ?? "";

    if (!city || !state) {
      return NOT_FOUND;
    }

    return { found: true, city, state };
  } catch (err) {
    console.warn("[postalLookup] upstream fetch failed:", err);
    return NOT_FOUND;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Second opinion for an Indian pincode, when api.postalpincode.in has no
 * record of one that exists.
 *
 * Its dataset has real gaps — 400062 (Goregaon West, Mumbai) answers "No
 * records found" — and the customer meets that as "no match found" against a
 * pincode printed on their own electricity bill.
 *
 * Not the generic Zippopotam reader above, for one reason: that one prefers
 * `state abbreviation`, which is right for a US state and wrong here — it
 * yields "MM" where the address, and ITD, want "Maharashtra". This takes the
 * full state name and never the abbreviation.
 *
 * The city it gives is a locality rather than a district (400062 reads
 * "Udyognagar", not "Mumbai"), which is why this runs second and not first.
 * A locality the customer can correct beats an empty field they must fill
 * from nothing, and the form already tells them it is editable.
 */
async function fetchIndiaFromZippopotam(code: string): Promise<PostalLookupResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(`${ZIPPOTAM_BASE_URL}/in/${code}`, {
      signal: controller.signal,
    });
    if (!res.ok) return NOT_FOUND;

    const data = (await res.json()) as ZippopotamResponse;
    const place = Array.isArray(data.places) ? data.places[0] : undefined;
    if (!place) return NOT_FOUND;

    const city = place["place name"]?.trim() ?? "";
    const state = place.state?.trim() ?? "";
    if (!city || !state) return NOT_FOUND;

    return { found: true, city, state };
  } catch (err) {
    console.warn("[postalLookup] IN zippopotam fallback failed:", err);
    return NOT_FOUND;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function lookupIndia(code: string): Promise<PostalLookupResult> {
  if (!/^\d{6}$/.test(code)) {
    return NOT_FOUND;
  }

  const key = cacheKey("IN", code);
  const cached = await readCache(key);
  if (cached) {
    return cached;
  }

  // India Post first: it answers with the District, which is the city an
  // address wants. Zippopotam only when that draws a blank.
  let result = await fetchIndiaFromUpstream(code);
  if (!result.found) {
    result = await fetchIndiaFromZippopotam(code);
    if (result.found) {
      console.log(`[postalLookup] ${code} resolved by the zippopotam fallback`);
    }
  }

  // writeCache ignores a miss, so a pincode that both sources happen to fail
  // on today is retried rather than remembered as unknown for a month.
  await writeCache(key, result);
  return result;
}

async function fetchZippopotamFromUpstream(
  countryCode: string,
  code: string
): Promise<PostalLookupResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(`${ZIPPOTAM_BASE_URL}/${countryCode.toLowerCase()}/${code}`, {
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[postalLookup] ${countryCode} upstream HTTP ${res.status}`);
      return NOT_FOUND;
    }

    const data = (await res.json()) as ZippopotamResponse;
    if (!Array.isArray(data.places) || data.places.length === 0) {
      return NOT_FOUND;
    }

    const place = data.places[0];
    const city = place["place name"]?.trim() ?? "";
    const state = (place["state abbreviation"] ?? place.state ?? "").trim();

    if (!city || !state) {
      return NOT_FOUND;
    }

    return { found: true, city, state };
  } catch (err) {
    console.warn(`[postalLookup] ${countryCode} upstream fetch failed:`, err);
    return NOT_FOUND;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function lookupZippopotam(countryCode: string, code: string): Promise<PostalLookupResult> {
  const key = cacheKey(countryCode, code);
  const cached = await readCache(key);
  if (cached) {
    return cached;
  }

  const result = await fetchZippopotamFromUpstream(countryCode, code);
  await writeCache(key, result);
  return result;
}

export async function lookupPostal(
  country: string,
  code: string
): Promise<PostalLookupResult> {
  try {
    const countryNorm = country.trim().toUpperCase();
    const codeNorm = code.trim();

    if (countryNorm === "IN") {
      return await lookupIndia(codeNorm);
    }

    return await lookupZippopotam(countryNorm, codeNorm);
  } catch (err) {
    console.warn("[postalLookup] lookupPostal failed:", err);
    return NOT_FOUND;
  }
}
