/**
 * Generate `migrations/seed_pickup_beats.sql` from `PICKUP_BEATS`.
 *
 *   npx tsx scripts/generate-beat-seed.ts          # write the migration
 *   npx tsx scripts/generate-beat-seed.ts --stdout # print it instead
 *
 * Unlike `generate-pickup-pincodes.ts`, which prints and refuses to write, this
 * one writes. The distinction is where the data comes from: that script pulls
 * ~4,000 answers off India Post and a human has to read the dropped list before
 * any of them are believed, so writing straight to the source would launder
 * unreviewed data into the repo. This script invents nothing. Every row it
 * emits is already in `shared/pickupPincodes.ts`, already reviewed in the diff
 * that put it there, and re-emitting it by hand would only introduce
 * transcription errors.
 *
 * Run it whenever `PICKUP_BEATS` changes, and commit both files together. The
 * static table and the database are meant to hold the same rows; this is what
 * keeps that true, and §4 requires the resulting statements to exist as a file
 * in migrations/ regardless of how they reached the database.
 *
 * The output is idempotent. Beats upsert on `slug` so a changed cutoff or name
 * lands on re-run; pincodes are deleted and re-inserted per beat, inside one
 * transaction, so a pincode dropped from a beat actually disappears rather than
 * lingering. Agent membership is never touched — ops own that from the console,
 * and this file has no business overwriting it.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PICKUP_BEATS, type PickupBeat } from '../shared/pickupPincodes.js';
import { PENDING_RIDERS, PICKUP_RIDERS } from './pickupRiders.js';

/** Postgres string literal. Doubling the quote is the whole escape. */
const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * The riders on a beat, for the comment above its INSERT.
 *
 * Names only, and only in a SQL comment — this migration never inserts into
 * `pickup_beat_agents`. Accounts are minted by `seed-pickup-riders.ts`, and
 * membership after that is ops' to change from the console; a re-seed of the
 * coverage must not quietly reassign anybody.
 */
function ridersOn(slug: string): string[] {
  return PICKUP_RIDERS.filter((r) => r.beats.includes(slug)).map((r) => r.full_name);
}

/** Named by ops but not creatable — no phone number ever came with them. */
function pendingOn(slug: string): string[] {
  return PENDING_RIDERS.filter((r) => r.beats.includes(slug)).map((r) => r.full_name);
}

/**
 * Slugs `PICKUP_BEATS` used to carry and no longer does.
 *
 * Retired, not deleted, for two reasons. A delete would cascade away the beat's
 * pincodes and any assignment ops had made against it. And the only way to
 * express "remove whatever is not in this list" is a blanket
 * `WHERE slug NOT IN (...)`, which would silently destroy any beat ops created
 * from the console — this file has no business reaching those.
 *
 * `is_active = false` takes the pincodes out of coverage immediately, since the
 * lookup joins `!inner` on active beats only. It shows as "Retired" in the ops
 * console and is one tap to undo.
 */
const RETIRED_SLUGS: readonly { slug: string; why: string }[] = [
  {
    slug: 'mumbai-fort',
    why: 'superseded 8 Sep by the three real Fort rounds, whose union is identical',
  },
];

function retirementBlock(): string {
  if (RETIRED_SLUGS.length === 0) return '';

  const lines = [
    '-- Beats this file no longer defines. Retired rather than deleted, so their',
    '-- rows and any ops assignments survive and the change is one tap to undo.',
  ];
  for (const { slug, why } of RETIRED_SLUGS) {
    lines.push(`-- ${slug}: ${why}`);
    lines.push(
      'UPDATE public.pickup_beats SET is_active = false, updated_at = now()',
      `WHERE slug = ${lit(slug)} AND is_active;`
    );
  }
  return lines.join('\n');
}

function beatBlock(beat: PickupBeat): string {
  const riders = ridersOn(beat.slug);
  const lines: string[] = [];

  lines.push(`-- ${beat.name} — ${beat.hub}, ${beat.rows.length} pincodes, cutoff ${beat.cutoffHour}:00`);
  const pending = pendingOn(beat.slug);
  if (riders.length > 0) {
    lines.push(`-- Riders: ${riders.join(', ')}`);
  } else if (pending.length > 0) {
    lines.push(
      `-- Riders: ${pending.join(', ')} — named by ops, NO PHONE NUMBER, so no`,
      `-- account exists and a job here still notifies every agent.`
    );
  } else {
    lines.push('-- Riders: none named by ops — a job here notifies every agent.');
  }

  lines.push(`INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)`);
  lines.push(
    `VALUES (${lit(beat.slug)}, ${lit(beat.name)}, ${lit(beat.hub)}, ${beat.cutoffHour})`
  );
  // `is_active` is deliberately absent from the update: a beat ops have
  // retired stays retired across a re-seed.
  lines.push(`ON CONFLICT (slug) DO UPDATE SET`);
  lines.push(`  name = EXCLUDED.name,`);
  lines.push(`  hub = EXCLUDED.hub,`);
  lines.push(`  cutoff_hour = EXCLUDED.cutoff_hour,`);
  lines.push(`  updated_at = now();`);
  lines.push('');

  lines.push(
    `DELETE FROM public.pickup_beat_pincodes`,
    `WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = ${lit(beat.slug)});`,
    ''
  );

  lines.push(`INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)`);
  lines.push(`SELECT b.id, v.pincode, v.city, v.area, v.remark`);
  lines.push(`FROM public.pickup_beats b, (VALUES`);

  const values = beat.rows.map(([pincode, area, surcharge, city]) => {
    const remark = surcharge === 1 ? 'out_of_city' : 'ok';
    return `  (${lit(pincode)}, ${lit(city ?? beat.city)}, ${lit(area)}, ${lit(remark)})`;
  });
  lines.push(values.join(',\n'));

  lines.push(`) AS v(pincode, city, area, remark)`);
  lines.push(`WHERE b.slug = ${lit(beat.slug)};`);

  return lines.join('\n');
}

function render(): string {
  const rowCount = PICKUP_BEATS.reduce((n, b) => n + b.rows.length, 0);

  const header = `-- Seed the pickup beats. GENERATED — do not edit by hand.
--
--     npx tsx scripts/generate-beat-seed.ts
--
-- Source of truth is \`PICKUP_BEATS\` in shared/pickupPincodes.ts, which stays
-- compiled into the app as the fallback for when this database is unreachable.
-- Editing this file instead of that one makes the two disagree, and the app
-- would then serve different coverage depending on whether Supabase answered.
--
-- ${PICKUP_BEATS.length} beats, ${rowCount} pincode rows.
--
-- Idempotent. Beats upsert on slug; each beat's pincodes are replaced wholesale
-- so a code removed upstream actually goes away. Runs in one transaction, so a
-- failure part-way leaves the previous coverage intact rather than a half-seeded
-- table that would quietly narrow what customers can book.
--
-- Agent membership (\`pickup_beat_agents\`) is never written here. Ops own it
-- from /ops/beats, and a re-seed must not undo their assignments.

BEGIN;

`;

  const body = PICKUP_BEATS.map(beatBlock).join('\n\n');
  const retired = retirementBlock();
  return `${header}${body}${retired ? `\n\n${retired}` : ''}\n\nCOMMIT;\n`;
}

const sql = render();

if (process.argv.includes('--stdout')) {
  console.log(sql);
} else {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const target = join(root, 'migrations', 'seed_pickup_beats.sql');
  writeFileSync(target, sql, 'utf8');
  const rows = PICKUP_BEATS.reduce((n, b) => n + b.rows.length, 0);
  console.log(`wrote ${target}`);
  console.log(`  ${PICKUP_BEATS.length} beats, ${rows} pincode rows`);
}
