-- The client onboarding document matrix (accounts dept, 14 Aug 2026).
-- Additive only: no column is dropped and no existing row changes meaning.
--
-- Two things arrive together, because neither is useful alone:
--   1. itd_users learns which of the four corporate categories an account is,
--      and the fields only some of them ask for.
--   2. account_documents holds the uploads. kyc_documents cannot: it is one
--      row per user by UNIQUE constraint, and a corporate account brings six.

-- ── itd_users ──────────────────────────────────────────────────────────────
ALTER TABLE public.itd_users
  ADD COLUMN IF NOT EXISTS company_category text
    CHECK (company_category IN ('corporate', 'co_courier', 'ecommerce', 'fbb')),
  ADD COLUMN IF NOT EXISTS contract_head text,
  ADD COLUMN IF NOT EXISTS group_code text,
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS lut_no text,
  ADD COLUMN IF NOT EXISTS iec_branch_code text,
  ADD COLUMN IF NOT EXISTS bank_account_no text,
  ADD COLUMN IF NOT EXISTS bank_ad_code text,
  ADD COLUMN IF NOT EXISTS contract_signed_name text,
  ADD COLUMN IF NOT EXISTS contract_version text,
  ADD COLUMN IF NOT EXISTS contract_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_accepted_ip text;

COMMENT ON COLUMN public.itd_users.company_category IS
  'One of the four corporate categories. NULL on personal accounts, and on the company accounts created before this column existed.';
COMMENT ON COLUMN public.itd_users.contract_head IS
  'ITD contract head derived from company_category: AC005 corporate/FBB, AC006 e-commerce, AC008 co-courier. Denormalised on purpose so a later change to the mapping does not rewrite history.';
COMMENT ON COLUMN public.itd_users.group_code IS
  'ITD group code. Only e-commerce carries one (B1305).';
COMMENT ON COLUMN public.itd_users.contract_signed_name IS
  'The name the customer typed as their signature at the last step of signup. Personal accounts sign here rather than uploading a signed copy; corporate accounts do both (the countersigned copy is the authorization_letter document).';
COMMENT ON COLUMN public.itd_users.contract_version IS
  'Which text was on screen when they signed (shared/contract.ts). An acceptance is only meaningful alongside the version it accepted.';
COMMENT ON COLUMN public.itd_users.contract_accepted_ip IS
  'Recorded with the timestamp as evidence of acceptance. Not used for anything else.';

COMMENT ON COLUMN public.itd_users.bank_ad_code IS
  'Authorised Dealer code of the bank branch handling export remittances. E-commerce only.';

-- ── account_documents ──────────────────────────────────────────────────────
-- A row is owned either by an account (user_id) or, before the account
-- exists, by an in-flight signup (signup_ref). Documents are compulsory
-- *before* creation, so every row starts life on the signup_ref side and is
-- claimed — user_id set, signup_ref cleared — when the account is written.
CREATE TABLE IF NOT EXISTS public.account_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.itd_users(id) ON DELETE CASCADE,
  signup_ref uuid,
  doc_slot text NOT NULL CHECK (doc_slot IN (
    'gst_certificate', 'iec_certificate', 'pan_card',
    'electricity_bill', 'telephone_bill', 'authorization_letter',
    'aadhaar_card'
  )),
  document_no text,
  capability_id uuid NOT NULL DEFAULT gen_random_uuid(),
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes integer NOT NULL,
  file_data text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_documents_owner_present
    CHECK (user_id IS NOT NULL OR signup_ref IS NOT NULL)
);

-- One document per slot per owner; re-uploading a slot replaces it.
CREATE UNIQUE INDEX IF NOT EXISTS account_documents_user_slot_key
  ON public.account_documents (user_id, doc_slot) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS account_documents_signup_slot_key
  ON public.account_documents (signup_ref, doc_slot) WHERE signup_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS account_documents_capability_id_key
  ON public.account_documents (capability_id);

-- Sweeping abandoned signups reads this.
CREATE INDEX IF NOT EXISTS account_documents_signup_ref_created_idx
  ON public.account_documents (signup_ref, created_at) WHERE signup_ref IS NOT NULL;

COMMENT ON TABLE public.account_documents IS
  'Onboarding documents. Owned by user_id once the account exists; by signup_ref while the signup is still in flight. file_data is base64, same as kyc_documents.';
COMMENT ON COLUMN public.account_documents.signup_ref IS
  'Per-session handle minted on the first upload of a signup and held in the express session. Cleared when the account claims the rows. Rows still carrying one after a day belong to an abandoned signup and can be deleted.';
COMMENT ON COLUMN public.account_documents.document_no IS
  'The number printed on the document, where the slot asks for one (PAN, Aadhaar). NULL for the bill and certificate slots.';
