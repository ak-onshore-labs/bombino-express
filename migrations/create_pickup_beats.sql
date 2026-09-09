-- Pickup beats — the rider config ops have always sent us, finally stored.
--
-- Every hand-over from Bombino ops arrives as the same four lines, per rider:
--
--     Pickup Boy Name :
--     Pickup Boy Contact Number:
--     Pickup Serviceable Pincodes
--     Pickup Cut-off Time
--
-- Until now only two of those four survived contact with the code. Name and
-- number became an `itd_users` row with `role = 'agent'`;  the pincodes and the
-- cutoff became a static table in `shared/pickupPincodes.ts`, keyed by hub, with
-- no way back to the rider. Nothing joined them. The consequence was small and
-- constant: `notifyAgentsOfNewJob` WhatsApps every agent in the country about
-- every job, because there was nothing to narrow it by.
--
-- These three tables are that join, and they are shaped like the hand-over
-- rather than like the spreadsheet stapled to it — every sheet has had a
-- different layout, and the four-line block is the only stable thing.
--
-- SEEDED, NOT AUTHORED HERE. `migrations/seed_pickup_beats.sql` is generated
-- from `PICKUP_BEATS` in shared/pickupPincodes.ts and fills these in. That file
-- stays compiled into the app as the fallback the server answers from when this
-- database cannot be reached; a lookup that can time out has no business
-- standing between a customer and a booking. Both sides resolve through the
-- same `buildCoverage`, so they cannot disagree about how to read a row.
--
-- §4 NOTE: `pickup_beat_agents` references `itd_users(id)`. That table is
-- Aditya's under the column partition, and the role it points at is agent, so
-- this is A-lane DDL throughout. Announce before applying anyway — it is new
-- referential integrity against a table both lanes read.
--
-- Additive only. No renames, no drops, no type changes. Fully idempotent: safe
-- to run whether or not it has already been applied out of band.

-- One rider's round. Ops reshuffle these when someone is off ("IF ANY PICKUP
-- BOY ABSENT AND LEAVE ADJUST ALL PICKUP BOY"), which is the whole reason this
-- is a table and not another static list — a reshuffle should not need a deploy.
CREATE TABLE IF NOT EXISTS public.pickup_beats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable id, matching `PickupBeat.slug` in shared/pickupPincodes.ts. The seed
  -- keys on it, so renaming one orphans its pincodes rather than moving them.
  slug text NOT NULL UNIQUE,

  -- The round as ops describe it: 'Jogeshwari → Borivali E/W'.
  name text NOT NULL,

  -- Office the riders run out of. Internal — a customer is never shown this.
  -- Deliberately not the customer-facing city: the Ghatkopar rounds run out of
  -- Andheri and collect in Thane, and the city belongs on the pincode.
  hub text NOT NULL,

  -- Latest IST hour a booking here is still collected the same day. 19 means
  -- 18:59 books today and 19:00 does not, matching `earliestPickupDate`.
  cutoff_hour smallint NOT NULL CHECK (cutoff_hour BETWEEN 0 AND 23),

  -- Retired rather than deleted. A beat that stops running should stop being
  -- offered without taking its pincode history with it.
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Where a beat collects, one row per pincode.
--
-- `city` and `area` are the customer's words, and they sit here rather than on
-- the beat for one real case: the Ghatkopar rounds cover Thane and Navi Mumbai
-- out of an Andheri hub, and "Thane is just outside Mumbai city limits" would
-- read as nonsense. The beat says where the rider starts; the row says where
-- the parcel is.
--
-- Beats overlap on purpose — 400077 sits in three Andheri rounds — so this is
-- keyed per beat, and `resolveCoverage` reconciles the several answers into the
-- one a customer is given: the latest cutoff among them, and 'ok' winning over
-- 'out_of_city'.
CREATE TABLE IF NOT EXISTS public.pickup_beat_pincodes (
  beat_id uuid NOT NULL REFERENCES public.pickup_beats(id) ON DELETE CASCADE,
  pincode text NOT NULL CHECK (pincode ~ '^[0-9]{6}$'),
  city text NOT NULL,
  area text NOT NULL,

  -- 'out_of_city' is a warning, never a block: the rider still comes, the run
  -- is outside the normal round, and the surcharge is settled at the weighing.
  -- Kolkata's sheet is the only source that has ever set it.
  remark text NOT NULL DEFAULT 'ok' CHECK (remark IN ('ok', 'out_of_city')),

  PRIMARY KEY (beat_id, pincode)
);

-- The hot path: "who covers 400062?", asked on every booking that requests a
-- pickup. The primary key leads with beat_id and cannot answer it.
CREATE INDEX IF NOT EXISTS pickup_beat_pincodes_pincode_idx
  ON public.pickup_beat_pincodes (pincode);

-- Which riders run which round. Many-to-many because both directions really
-- happen: two riders share the Andheri East to Powai beat, and a rider covering
-- for an absent colleague picks up a second one.
CREATE TABLE IF NOT EXISTS public.pickup_beat_agents (
  beat_id uuid NOT NULL REFERENCES public.pickup_beats(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.itd_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (beat_id, agent_id)
);

-- "Which beats is this agent on?" — the ops console staff list asks it per row.
CREATE INDEX IF NOT EXISTS pickup_beat_agents_agent_idx
  ON public.pickup_beat_agents (agent_id);

COMMENT ON TABLE public.pickup_beats IS
  'One pickup rider''s round: a named pincode set with its own same-day cutoff. Seeded from PICKUP_BEATS in shared/pickupPincodes.ts, which stays the fallback when this database is unreachable. Edited by ops at /ops/beats.';

COMMENT ON TABLE public.pickup_beat_pincodes IS
  'Where a beat collects. city/area are customer-facing and live here, not on the beat, because a beat can collect outside its own hub city (Andheri rounds cover Thane). Beats overlap; resolveCoverage() reconciles them.';

COMMENT ON TABLE public.pickup_beat_agents IS
  'Which agents run which beat. Many-to-many: two riders share the Andheri-Powai round, and cover is picked up across beats when someone is off. Narrows the new-job WhatsApp fan-out; does NOT restrict what an agent may claim.';
