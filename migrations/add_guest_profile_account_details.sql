-- The rest of what an account asks for, collected before the account exists.
--
-- Additive and idempotent. Nothing is dropped and no existing row changes
-- meaning.
--
-- Run AFTER add_guest_profile_account_type.sql.
--
-- ── Why the whole set, and why here ────────────────────────────────────────
--
-- A guest who intends to open a company account has to produce the same things
-- signup asks for: the category, the registered name, the GST number, a
-- contact person, an address with its hub, and the extra references that
-- category happens to need (shared/accountSpec.ts §requiredExtraFields).
-- Collecting them one row at a time on the profile, over as many visits as it
-- takes, is the point — signup asks for all of it at once, which is the wall a
-- guest declined to climb in the first place.
--
-- Personal accounts need nothing new: full_name and email already cover what
-- signup asks, and the phone is proved by OTP before a profile row exists.
--
-- Every column is nullable. "Not answered yet" is the normal state of this
-- table, and the profile screen renders each null as one pending row.
--
-- ── What is authoritative ─────────────────────────────────────────────────
--
-- Nothing here is. itd_users owns the account once one exists; this is what
-- the customer has told us on the way to opening it, and signup re-validates
-- the lot. The one exception worth naming is `gstin_verified_name`: it is the
-- GST registry's own spelling, returned by verifyGstin, and it is stored so
-- the profile can show what the number is actually registered to rather than
-- echoing back what the customer typed.

ALTER TABLE public.guest_profiles
  ADD COLUMN IF NOT EXISTS company_category text,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS gstin text,
  ADD COLUMN IF NOT EXISTS gstin_verified_name text,
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS address_line_1 text,
  ADD COLUMN IF NOT EXISTS pincode text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS hub_id text,
  -- The category's extra references: lut_no, iec_branch_code, bank_account_no,
  -- bank_ad_code. jsonb rather than four columns because which of them apply
  -- is decided by COMPANY_CATEGORY_SPECS, and a category added there should
  -- not need a migration here.
  ADD COLUMN IF NOT EXISTS extras jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.guest_profiles'::regclass
       AND conname = 'guest_profiles_company_category_check'
  ) THEN
    ALTER TABLE public.guest_profiles
      ADD CONSTRAINT guest_profiles_company_category_check
      CHECK (
        company_category IS NULL
        OR company_category IN ('corporate', 'co_courier', 'ecommerce', 'fbb')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.guest_profiles.company_category IS
  'One of the four corporate categories in shared/accountSpec.ts §COMPANY_CATEGORIES. Decides which documents and extra fields the account will owe. NULL until chosen, and meaningless unless account_type = ''company''.';
COMMENT ON COLUMN public.guest_profiles.gstin IS
  'The GST number as verified through /api/signup/identity/gstin. Format and mod-36 checksum are checked before the lookup is billed; the registry is what confirms it.';
COMMENT ON COLUMN public.guest_profiles.gstin_verified_name IS
  'The legal name the GST registry returned for that number. Kept so the profile can show what the GSTIN is registered to, rather than echoing the name the customer typed.';
COMMENT ON COLUMN public.guest_profiles.extras IS
  'Category-specific references keyed by shared/accountSpec.ts §ExtraField: lut_no, iec_branch_code, bank_account_no, bank_ad_code. Only the keys that category requires are ever written.';
