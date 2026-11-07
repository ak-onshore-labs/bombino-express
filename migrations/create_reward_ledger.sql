-- Reward points ledger (phase 1, points only). See docs/rewards/rewards-plan.md.
--
-- One row per thing that moves a customer's points: earned on an order once
-- the parcel is delivered, used
-- on an order, given back, taken back, expired at the end of the financial
-- year, or adjusted by hand. Insert-only; nothing updates a row.
--
-- Balance = sum(points). Pending points ("on the way") are NOT rows: they are
-- worked out from the customer's open orders, so a cancelled order needs no
-- reversing row for points it never had.
--
-- weight_kg rides on the same rows so the yearly weight milestone is a sum too:
-- the parcel weight on `earn`, the same weight negative on `clawback`.
--
-- Additive-only. The app reads this table defensively: until it exists every
-- read answers "no points" and no booking or dispatch is held up.
--
-- Run AFTER create_orders_and_order_events.sql and create_payments.sql.

CREATE TABLE IF NOT EXISTS public.reward_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Accounts only. A guest booking never earns, even after the guest makes an
  -- account, so there is no guest_ref here.
  user_id uuid NOT NULL REFERENCES public.itd_users(id) ON DELETE CASCADE,

  -- Null only for year-end expiry and manual adjustments.
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,

  -- forfeit: 0 points, the parcel ended undelivered (RTO, lost…) and never
  -- earns. Recorded so it stops showing as "on the way".
  kind text NOT NULL CHECK (
    kind IN ('earn', 'forfeit', 'redeem', 'redeem_back', 'clawback', 'expiry', 'adjust')
  ),

  -- Signed: earn / redeem_back positive, redeem / clawback / expiry negative.
  points integer NOT NULL,

  -- Parcel kg counted toward the weight milestone (earn +, clawback −).
  weight_kg numeric NOT NULL DEFAULT 0,

  -- Financial year the row counts in, IST: '2026-27'.
  fy text NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),

  note text,
  -- Ops user who made a manual adjustment.
  created_by uuid REFERENCES public.itd_users(id),
  metadata jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reward_ledger_order_present
    CHECK (order_id IS NOT NULL OR kind IN ('expiry', 'adjust')),
  CONSTRAINT reward_ledger_adjust_explained
    CHECK (kind <> 'adjust' OR (note IS NOT NULL AND created_by IS NOT NULL))
);

-- An order earns (or forfeits) once and is taken back once, however many
-- times the event that triggers it fires (tracking polled again, retries).
CREATE UNIQUE INDEX IF NOT EXISTS reward_ledger_once_per_order
  ON public.reward_ledger (order_id, kind)
  WHERE kind IN ('earn', 'forfeit', 'clawback');

-- One expiry per customer per year.
CREATE UNIQUE INDEX IF NOT EXISTS reward_ledger_expiry_once
  ON public.reward_ledger (user_id, fy)
  WHERE kind = 'expiry';

CREATE INDEX IF NOT EXISTS reward_ledger_user_idx
  ON public.reward_ledger (user_id, created_at DESC);

ALTER TABLE public.reward_ledger ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.reward_ledger IS
  'Reward points ledger, insert-only. Balance = sum(points); pending points are worked out from open orders. See docs/rewards/rewards-plan.md.';
