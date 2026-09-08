/**
 * Read-only: derive the Surat, Pune and Chennai pickup pincode lists from
 * India Post, and print them as `Row` tuples for shared/pickupPincodes.ts.
 *
 *   npx tsx scripts/generate-pickup-pincodes.ts
 *   npx tsx scripts/generate-pickup-pincodes.ts surat pune
 *
 * Prints; it does not write. The lists are static data in a reviewed diff, and
 * a script that edits them straight into the file would put ~4,000 upstream
 * answers into the repo without anyone reading one of them.
 *
 * Why a sweep and not a city lookup: api.postalpincode.in answers by pincode
 * and by post office name, never "give me every code in Surat". So we walk the
 * city's postal blocks one code at a time and keep what comes back matching.
 *
 * The filter is the interesting part. A postal *district* is far bigger than a
 * rider's beat — "Pune district" reaches Junnar and Baramati, some 100km out —
 * so district alone would have us promising doorstep pickup in villages. Each
 * post office also carries a `Block`, and for Surat and Pune the block names
 * the city proper. Chennai's blocks are inconsistent (`NA`, bare post office
 * names), but its district boundary is already tight enough to stand alone:
 * 600130 comes back as Kanchipuram and drops out on district.
 *
 * A pincode straddling city and rural blocks is kept — if any post office in it
 * sits on the city beat, a rider passes through.
 *
 * Responses are cached under the OS temp dir, so a re-run is free and an
 * interrupted sweep resumes where it stopped.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = "https://api.postalpincode.in/pincode";
const CACHE_DIR = join(tmpdir(), "bombino-pincodes");
const CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

interface PostOffice {
  Name?: string;
  District?: string;
  State?: string;
  Block?: string;
}

/** What we keep per pincode. `offices` is empty for a code India Post rejects. */
interface Record {
  pincode: string;
  offices: PostOffice[];
}

interface CitySpec {
  /** Hub name, and the `area` every generated row carries. */
  city: string;
  /** Inclusive numeric spans to sweep. */
  ranges: readonly (readonly [number, number])[];
  /** Printed above the results, so the rule is visible next to what it produced. */
  rule: string;
  /** Whether a live pincode in the swept range belongs to this city. */
  keep: (code: number, offices: readonly PostOffice[]) => boolean;
}

const inSeries = (code: number, from: number, to: number): boolean => code >= from && code <= to;

const hasDistrict = (offices: readonly PostOffice[], district: string): boolean =>
  offices.some((o) => norm(o.District) === norm(district));

/**
 * India Post is not consistent about transliteration — Ahmedabad is filed as
 * "Ahmadabad" on most offices and "Ahmedabad" on a few. Matching one spelling
 * silently drops the other, so callers pass every spelling the city answers to.
 */
const hasAnyDistrict = (offices: readonly PostOffice[], districts: readonly string[]): boolean =>
  districts.some((d) => hasDistrict(offices, d));

const hasBlock = (offices: readonly PostOffice[], blocks: readonly string[]): boolean =>
  offices.some((o) => blocks.some((b) => norm(o.Block) === norm(b)));

/**
 * The postal series is the signal, not the district or the block.
 *
 * Both of the finer fields were tried first and both misfire. India Post's
 * `District` predates the 2018 boundary redraw, so Chromepet and Perungudi —
 * inside the Greater Chennai Corporation — still answer "Kanchipuram", and a
 * district filter drops half of Chennai. `Block` is no better: Sarthana and
 * Puna Kumbharia are Surat city but sit in block "Choryasi", and Pimple Gurav
 * is PCMC but reads "Haveli".
 *
 * The series holds where those fail. 395xxx is Surat city and 394xxx its rural
 * district; 411xxx is Pune with PCMC and 412xxx the district beyond it; 600xxx
 * is Chennai's metro block, with Chengalpattu starting at 603xxx. Sweeping the
 * series and keeping the codes India Post actually answers for gives the city
 * without the dead numbers a blanket range would have accepted.
 */
const CITIES: readonly CitySpec[] = [
  {
    city: "Surat",
    // 394xxx is swept as well: the Udhna/Sachin belt is Surat city on a district
    // number, which is exactly what a blanket 395001-395999 would have missed.
    ranges: [[394001, 395999]],
    rule: '395xxx in district Surat, plus 394xxx on the "Surat City" or "Udhna" block',
    keep: (code, offices) =>
      hasDistrict(offices, "Surat") &&
      (inSeries(code, 395001, 395999) || hasBlock(offices, ["Surat City", "Udhna"])),
  },
  {
    city: "Pune",
    ranges: [[411001, 411999]],
    rule: "411xxx in district Pune (the city plus PCMC; 412xxx is the rural district)",
    keep: (_code, offices) => hasDistrict(offices, "Pune"),
  },
  {
    city: "Chennai",
    ranges: [[600001, 600999]],
    // No district test: it would discard the Greater Chennai suburbs that
    // India Post still files under Kanchipuram and Tiruvallur.
    rule: "600xxx, any district — the whole Chennai metro block",
    keep: () => true,
  },
  {
    city: "Ahmedabad",
    // 380xxx is the city proper. 382xxx is swept too because the eastern
    // industrial belt — Naroda, Nikol, Vatva, Odhav — is Ahmedabad on a
    // district number, the same shape as Surat's 394xxx tail.
    ranges: [[380001, 382999]],
    // Gandhinagar is 382010 and sits in the middle of the swept range. It is a
    // different city with its own branch, and the district test is what keeps
    // it out — read the dropped list before accepting this hub's rows.
    rule: '380xxx and 382xxx in district Ahmadabad/Ahmedabad (Gandhinagar drops out)',
    keep: (_code, offices) => hasAnyDistrict(offices, ["Ahmadabad", "Ahmedabad"]),
  },
];

const norm = (value: string | undefined): string => (value ?? "").trim().toLowerCase();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function readCache(pincode: string): Promise<Record | null> {
  try {
    const raw = await readFile(join(CACHE_DIR, `${pincode}.json`), "utf8");
    return JSON.parse(raw) as Record;
  } catch {
    return null;
  }
}

async function writeCache(record: Record): Promise<void> {
  await writeFile(join(CACHE_DIR, `${record.pincode}.json`), JSON.stringify(record), "utf8");
}

/**
 * One pincode, cached. A code India Post has no record of is a real answer, not
 * a failure — it caches as an empty office list so a re-run does not ask again.
 * Only network trouble retries.
 */
async function lookup(pincode: string): Promise<Record> {
  const cached = await readCache(pincode);
  if (cached) return cached;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${API}/${pincode}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = (await res.json()) as Array<{ Status?: string; PostOffice?: PostOffice[] | null }>;
      const first = body?.[0];
      const offices = first?.Status === "Success" ? first.PostOffice ?? [] : [];

      const record: Record = { pincode, offices };
      await writeCache(record);
      return record;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) await sleep(400 * attempt);
    }
  }

  throw new Error(`${pincode}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/** Walk `codes` `CONCURRENCY` at a time, reporting progress as it goes. */
async function sweep(codes: readonly string[], label: string): Promise<Record[]> {
  const out: Record[] = new Array(codes.length);
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= codes.length) return;

      out[i] = await lookup(codes[i]);

      done += 1;
      if (done % 100 === 0 || done === codes.length) {
        process.stdout.write(`\r  ${label}: ${done}/${codes.length}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n");
  return out;
}

function expand(spec: CitySpec): string[] {
  const codes: string[] = [];
  for (const [from, to] of spec.ranges) {
    for (let n = from; n <= to; n += 1) codes.push(String(n));
  }
  return codes;
}

interface CityResult {
  spec: CitySpec;
  kept: string[];
  /** Live in the swept range, but not this city. */
  dropped: string[];
  /** Districts the kept codes span, and how many each contributed. */
  districtSpread: Map<string, number>;
  live: number;
}

function classify(spec: CitySpec, records: readonly Record[]): CityResult {
  const kept: string[] = [];
  const dropped: string[] = [];
  const districtSpread = new Map<string, number>();
  let live = 0;

  for (const record of records) {
    if (record.offices.length === 0) continue;
    live += 1;

    if (!spec.keep(Number(record.pincode), record.offices)) {
      dropped.push(record.pincode);
      continue;
    }

    kept.push(record.pincode);
    for (const district of new Set(record.offices.map((o) => (o.District ?? "?").trim()))) {
      districtSpread.set(district, (districtSpread.get(district) ?? 0) + 1);
    }
  }

  kept.sort();
  dropped.sort();
  return { spec, kept, dropped, districtSpread, live };
}

function report(result: CityResult): void {
  const { spec, kept, dropped, districtSpread, live } = result;

  console.log(`\n${"=".repeat(72)}`);
  console.log(`${spec.city.toUpperCase()}  —  ${spec.rule}`);
  console.log("=".repeat(72));
  console.log(`  live pincodes in swept range : ${live}`);
  console.log(`  kept                         : ${kept.length}`);
  console.log(`  dropped                      : ${dropped.length}`);

  if (dropped.length > 0) {
    console.log(`    ${dropped.join(", ")}`);
  }

  const spread = [...districtSpread.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([district, count]) => `${district} (${count})`);
  console.log(`  districts among kept         : ${spread.join(", ")}`);

  console.log(`\nconst ${spec.city.toUpperCase()}: readonly Row[] = [`);
  for (const pincode of kept) {
    console.log(`  ['${pincode}', '${spec.city}', 0],`);
  }
  console.log("];");
}

async function main(): Promise<void> {
  const wanted = process.argv.slice(2).map((a) => a.toLowerCase());
  const specs = wanted.length > 0 ? CITIES.filter((c) => wanted.includes(c.city.toLowerCase())) : CITIES;

  if (specs.length === 0) {
    console.error(`No such city. Known: ${CITIES.map((c) => c.city).join(", ")}`);
    process.exit(1);
  }

  await mkdir(CACHE_DIR, { recursive: true });
  console.log(`cache: ${CACHE_DIR}\n`);

  const results: CityResult[] = [];
  for (const spec of specs) {
    const codes = expand(spec);
    console.log(`${spec.city}: sweeping ${codes.length} codes`);
    const records = await sweep(codes, spec.city);
    results.push(classify(spec, records));
  }

  for (const result of results) report(result);

  console.log(
    `\nReview the rejected and other-district lists above before pasting. ` +
      `A surprise there means the filter, not the data, needs a second look.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
