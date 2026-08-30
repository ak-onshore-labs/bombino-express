-- Pickup windows are gone. A pickup now carries a date and nothing finer: the
-- customer names a day, the agent collects when they reach the address.
--
-- IRREVERSIBLE. `orders.pickup_slot` holds the window every historical pickup
-- was actually booked into, and dropping the column destroys that record — no
-- backup of it is kept anywhere else. Take a dump of the column first if the
-- history is wanted:
--
--   COPY (SELECT id, order_no, pickup_date, pickup_slot FROM public.orders
--         WHERE pickup_slot IS NOT NULL) TO STDOUT WITH CSV HEADER;
--
-- Run it AFTER the application deploy, not before. The old build reads
-- `pickup_slot` in its order SELECT lists, so dropping the column while it is
-- still serving turns every order read into a Postgres error. The new build
-- never names the column, so it is happy either way.

-- ── orders.pickup_slot ─────────────────────────────────────────────────────
-- The CHECK goes with the column automatically; it is dropped by definition
-- first anyway, because it was auto-named on some deployments and explicitly
-- named on others.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%pickup_slot%'
  LOOP
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.orders DROP COLUMN IF EXISTS pickup_slot;

-- ── The rosters ────────────────────────────────────────────────────────────
-- `agent_weekly_availability` answered one question — "is any agent working
-- this window?" — asked at booking to decide whether a slot could be offered.
-- Nothing asks it now: every free job is offered to every agent, and the
-- WhatsApp fan-out goes to all of them (server/whatsappAgents.ts).
--
-- `agent_availability` is its per-date predecessor, deprecated and unread since
-- create_agent_weekly_availability.sql. Both go together rather than leaving a
-- dead table behind for someone to rediscover and wire back up.
DROP TABLE IF EXISTS public.agent_weekly_availability;
DROP TABLE IF EXISTS public.agent_availability;
