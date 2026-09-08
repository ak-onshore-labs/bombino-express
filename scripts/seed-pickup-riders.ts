/**
 * Create the real pickup riders and put them on their beats.
 *
 *   npx tsx --env-file=.env scripts/seed-pickup-riders.ts            # dry run
 *   npx tsx --env-file=.env scripts/seed-pickup-riders.ts --apply    # write
 *
 * DRY RUN BY DEFAULT, which is not the usual convention in this folder and is
 * deliberate. Every other seed script writes obviously fake data — the
 * 90000000xx block, "Test Customer (seed)". This one writes real people. An
 * account here means a named rider can sign in by OTP to their own mobile, and
 * means the new-job fan-out starts sending WhatsApp messages to that number.
 * That is a thing to do on purpose, having read the plan, not by running a
 * script to see what it does.
 *
 * Roster: `scripts/pickupRiders.ts`. Beats: `PICKUP_BEATS`, seeded into
 * `pickup_beats` by `migrations/seed_pickup_beats.sql`, which must be applied
 * first — this script resolves beats by slug and will tell you which are
 * missing rather than inventing them.
 *
 * Idempotent, and conservative about what it will touch:
 *
 *   - a phone with no account gets one, `role = 'agent'`, active
 *   - a phone that is already an agent is reused as-is; nothing is renamed
 *   - a phone belonging to anyone else — a customer, an admin — ABORTS the run.
 *     `seed-dummy-agents.mjs` learned this the hard way after demoting the test
 *     super admin: an account this script did not create is not its to change.
 *
 * Beat membership is added, never replaced. Ops assign cover from /ops/beats
 * and a re-run must not undo them.
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { PICKUP_RIDERS, unstaffedBeats, type PickupRider } from './pickupRiders.js';

const APPLY = process.argv.includes('--apply');
const AS_SQL = process.argv.includes('--sql');

/** Postgres string literal. Doubling the quote is the whole escape. */
const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * The same work as SQL, for pasting into the Supabase editor.
 *
 * Emitted from this file's roster rather than written by hand, so the two
 * cannot drift. Touches no database itself — this branch returns before the
 * client is ever built, which is why it needs no environment.
 *
 * Three statements, meant to be run in order and looked at in between:
 *
 *   1. a read-only pre-flight, which should return NO ROWS. Anything it returns
 *      is a number that already belongs to somebody who is not an agent, and
 *      step 2 will skip it — deliberately. Resolve those by hand.
 *   2. the writes, in one transaction.
 *   3. a read-only check of what landed.
 */
function emitSql(): string {
  const phones = PICKUP_RIDERS.map((r) => lit(r.phone)).join(', ');

  const riderValues = PICKUP_RIDERS.map(
    (r) =>
      `    (${lit(r.full_name)}, ${lit(r.phone)}, ${r.hub_id}, ${
        r.note ? lit(r.note) : 'NULL'
      })`
  ).join(',\n');

  const links = PICKUP_RIDERS.flatMap((r) =>
    r.beats.map((slug) => `    (${lit(r.phone)}, ${lit(slug)})`)
  ).join(',\n');

  return `-- Pickup riders, from scripts/pickupRiders.ts. GENERATED:
--     npx tsx scripts/seed-pickup-riders.ts --sql
--
-- ${PICKUP_RIDERS.length} riders, ${PICKUP_RIDERS.reduce((n, r) => n + r.beats.length, 0)} beat assignments.
-- Creating these lets each rider sign in by OTP on their own mobile and starts
-- the new-job WhatsApp fan-out messaging them. Run it when you mean to.
--
-- Requires migrations/create_pickup_beats.sql and seed_pickup_beats.sql first.


-- ── 1. PRE-FLIGHT (read-only). Expect zero rows. ───────────────────────────
-- Any row here is a number already held by a non-agent. Step 2 will not touch
-- it and step 3 will show the rider missing. Sort those out by hand rather than
-- changing an account that was created for something else.

SELECT phone, full_name, role, is_active
FROM public.itd_users
WHERE phone IN (${phones})
  AND role <> 'agent';


-- ── 2. THE WRITES ──────────────────────────────────────────────────────────

BEGIN;

-- Missing riders only. An existing agent on the same number is left exactly as
-- it is: not renamed, not re-hubbed, not reactivated.
INSERT INTO public.itd_users (
  itd_customer_id, itd_customer_code, full_name, email,
  username, phone, role, is_active, metadata
)
SELECT
  s.id, s.id, v.full_name, '',
  v.phone, v.phone, 'agent', true,
  jsonb_build_object(
    'created_by', 'scripts/seed-pickup-riders.ts',
    'created_at', now(),
    'hub_id', v.hub_id
  ) || CASE WHEN v.note IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('ops_note', v.note) END
FROM (VALUES
${riderValues}
) AS v(full_name, phone, hub_id, note)
CROSS JOIN LATERAL (SELECT 'local-' || gen_random_uuid() AS id) s
WHERE NOT EXISTS (
  SELECT 1 FROM public.itd_users u WHERE u.phone = v.phone
);

-- Beat membership. Additive — a rider ops assigned elsewhere by hand keeps it.
-- The role check is load bearing: it is what stops a number belonging to a
-- customer or an admin being quietly added to the job fan-out.
INSERT INTO public.pickup_beat_agents (beat_id, agent_id)
SELECT b.id, u.id
FROM (VALUES
${links}
) AS v(phone, slug)
JOIN public.itd_users u ON u.phone = v.phone AND u.role = 'agent'
JOIN public.pickup_beats b ON b.slug = v.slug
ON CONFLICT (beat_id, agent_id) DO NOTHING;

COMMIT;


-- ── 3. CHECK (read-only) ───────────────────────────────────────────────────
-- Expect one row per beat that has riders, and every name you recognise.

SELECT b.hub, b.name AS beat, b.cutoff_hour, b.is_active,
       count(u.id) AS riders,
       string_agg(u.full_name, ', ' ORDER BY u.full_name) AS who
FROM public.pickup_beats b
LEFT JOIN public.pickup_beat_agents m ON m.beat_id = b.id
LEFT JOIN public.itd_users u ON u.id = m.agent_id
GROUP BY b.hub, b.name, b.cutoff_hour, b.is_active
ORDER BY count(u.id) DESC, b.hub, b.name;
`;
}

if (AS_SQL) {
  console.log(emitSql());
  process.exit(0);
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (pass --env-file=.env).');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function die(what: string, error: unknown): never {
  console.error(`\n${what} failed:`, error);
  process.exit(1);
}

type ExistingUser = { id: string; role: string; full_name: string | null };

async function findByPhone(phone: string): Promise<ExistingUser | null> {
  const { data, error } = await db
    .from('itd_users')
    .select('id, role, full_name')
    .eq('phone', phone)
    .maybeSingle();
  if (error) die(`lookup ${phone}`, error.message);
  return (data as ExistingUser) ?? null;
}

/** Same shape `POST /api/ops/users` mints, so these are ordinary staff rows. */
async function createRider(rider: PickupRider): Promise<string> {
  const syntheticId = `local-${randomUUID()}`;
  const { data, error } = await db
    .from('itd_users')
    .insert({
      itd_customer_id: syntheticId,
      itd_customer_code: syntheticId,
      full_name: rider.full_name,
      email: '',
      username: rider.phone,
      phone: rider.phone,
      role: 'agent',
      is_active: true,
      metadata: {
        created_by: 'scripts/seed-pickup-riders.ts',
        created_at: new Date().toISOString(),
        hub_id: rider.hub_id,
        ...(rider.note ? { ops_note: rider.note } : {}),
      },
    })
    .select('id')
    .single();
  if (error) die(`create ${rider.full_name}`, error.message);
  return (data as { id: string }).id;
}

async function main(): Promise<void> {
  const { data: beatRows, error: beatError } = await db
    .from('pickup_beats')
    .select('id, slug, name');
  if (beatError) die('load beats', beatError.message);

  const beats = new Map<string, { id: string; name: string }>();
  for (const b of (beatRows ?? []) as { id: string; slug: string; name: string }[]) {
    beats.set(b.slug, { id: b.id, name: b.name });
  }

  if (beats.size === 0) {
    console.error('No beats in the database. Apply migrations/seed_pickup_beats.sql first.');
    process.exit(1);
  }

  // Fail before writing anything, not halfway through.
  const missing = [
    ...new Set(PICKUP_RIDERS.flatMap((r) => r.beats.filter((slug) => !beats.has(slug)))),
  ];
  if (missing.length > 0) {
    console.error(`Beats named in the roster but absent from the database: ${missing.join(', ')}`);
    console.error('Re-run scripts/generate-beat-seed.ts and apply the seed migration.');
    process.exit(1);
  }

  console.log(APPLY ? 'APPLYING\n' : 'DRY RUN — nothing will be written. Pass --apply to write.\n');

  let created = 0;
  let reused = 0;
  let linked = 0;

  for (const rider of PICKUP_RIDERS) {
    const existing = await findByPhone(rider.phone);

    if (existing && existing.role !== 'agent') {
      die(
        `refusing ${rider.full_name} (${rider.phone})`,
        `that number already belongs to a '${existing.role}' account (${existing.full_name ?? 'unnamed'}). ` +
          `Resolve it by hand — this script will not change an account it did not create.`
      );
    }

    let agentId = existing?.id ?? null;
    if (existing) {
      reused += 1;
      console.log(`reuse   ${rider.phone}  ${rider.full_name.padEnd(22)} already an agent`);
    } else if (APPLY) {
      agentId = await createRider(rider);
      created += 1;
      console.log(`create  ${rider.phone}  ${rider.full_name.padEnd(22)} new agent`);
    } else {
      created += 1;
      console.log(`create  ${rider.phone}  ${rider.full_name.padEnd(22)} would be created`);
    }

    for (const slug of rider.beats) {
      const beat = beats.get(slug)!;
      if (APPLY && agentId) {
        // Additive: a rider ops put on another beat by hand keeps it.
        const { error } = await db
          .from('pickup_beat_agents')
          .upsert(
            { beat_id: beat.id, agent_id: agentId },
            { onConflict: 'beat_id,agent_id', ignoreDuplicates: true }
          );
        if (error) die(`assign ${rider.full_name} -> ${slug}`, error.message);
      }
      linked += 1;
      console.log(`   beat  ${beat.name}`);
    }
    if (rider.note) console.log(`   note  ${rider.note}`);
  }

  const slugs = [...beats.keys()];
  const unstaffed = unstaffedBeats(slugs);

  console.log(
    `\n${APPLY ? 'Done' : 'Would do'}: ${created} created, ${reused} reused, ${linked} beat assignments.`
  );
  if (unstaffed.length > 0) {
    console.log(
      `\n${unstaffed.length} beat(s) still have nobody on them, so a job there still notifies every agent:`
    );
    for (const slug of unstaffed) console.log(`  ${slug}  —  ${beats.get(slug)?.name ?? '?'}`);
  }
  if (!APPLY) console.log('\nNothing was written. Re-run with --apply.');
}

await main();
