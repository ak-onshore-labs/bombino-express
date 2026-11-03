-- An Indian WhatsApp number for a customer who signs in from abroad.
--
-- A customer can sign in with a number from any country ("+974…",
-- shared/contact.ts). WhatsApp updates go to that number by default. When it
-- turns out not to be on WhatsApp (whatsappDb §Reachability), the app asks for
-- an Indian number that is, and updates go there instead.
--
-- Keyed on the customer's own number rather than on an account or a guest ref:
-- a guest has several refs over time, and an approved application turns the
-- guest into an account without the number changing. The number is the one
-- thing that stays put.
--
-- A row only exists once the alternate number has been proved: a code is sent
-- on WhatsApp to it and typed back (server/routes/whatsappAlt.ts). Removing the
-- number deletes the row.
--
-- Additive-only. The app reads this table defensively: until it exists, every
-- read answers "no alternate number" and messages go to the sign-in number as
-- they did before.

CREATE TABLE IF NOT EXISTS public.whatsapp_alt_numbers (
  -- The sign-in number, as itd_users.phone / guest_profiles.phone store it.
  phone text PRIMARY KEY,
  -- Bare 10-digit Indian mobile.
  alt_phone text NOT NULL CHECK (alt_phone ~ '^[6-9][0-9]{9}$'),
  verified_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_alt_numbers ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.whatsapp_alt_numbers IS
  'Verified Indian WhatsApp number for a customer whose sign-in number (from abroad) is not on WhatsApp.';
