-- The shape of account a guest intends to open.
--
-- Additive and idempotent. Nothing is dropped and no existing row changes
-- meaning.
--
-- Run AFTER create_guest_profiles.sql.
--
-- ── Why it is stored, and stored here ──────────────────────────────────────
--
-- Account type is the first thing signup asks, because it decides everything
-- after it: the fields, the document matrix (shared/accountSpec.ts), who signs
-- the contract, and whose name the invoice carries. It was only ever a URL
-- parameter into /signup, which meant a guest who chose "company", left, and
-- came back was asked again as though they had never answered.
--
-- Kept beside the guest's other details rather than in a table of its own: it
-- is one of the things we know about this person, sits in the same list as
-- their name and email on the profile screen, and is claimed or discarded with
-- the rest of the row when they open an account.
--
-- NOT authoritative for the account that eventually gets created. itd_users
-- owns that (`account_type`, added in add_signup_accounts.sql); this is the
-- customer's stated intent, and signup is free to open a different shape if
-- they change the toggle on the way through.

ALTER TABLE public.guest_profiles
  ADD COLUMN IF NOT EXISTS account_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.guest_profiles'::regclass
       AND conname = 'guest_profiles_account_type_check'
  ) THEN
    -- Nullable: "not chosen yet" is a real and common state, and the profile
    -- screen renders it as the one pending row that leads the list.
    ALTER TABLE public.guest_profiles
      ADD CONSTRAINT guest_profiles_account_type_check
      CHECK (account_type IS NULL OR account_type IN ('personal', 'company'));
  END IF;
END $$;

COMMENT ON COLUMN public.guest_profiles.account_type IS
  'Which shape of account this guest says they want: personal or company. NULL until they choose. Preselects the type at /signup and is the customer''s stated intent only — itd_users.account_type is authoritative once an account exists.';
