-- The identity numbers signup collects, and what each one is worth, recorded
-- before any document is uploaded (server/cashfreeIdentity.ts).
--
-- Additive only. Run AFTER add_account_categories_and_documents.sql — the
-- ownership model here is copied from account_documents and the FK needs
-- itd_users to exist.
--
-- Where a number is checked with an authority — GSTIN alone, now — a row is
-- written only when that authority said yes. There is no "refused" state,
-- because unlike a document there is nothing to store: a rejected GSTIN never
-- reaches this table, and account creation refuses to proceed without one row
-- per required check.
--
-- Aadhaar and PAN are the exceptions and `status` is where it shows. Nothing
-- checks either number any more — DigiLocker and the Income Tax lookup were
-- both removed — so the customer types them and the documents they upload
-- have to carry them. Those rows land as `self_declared`.
--
-- Ownership works exactly as account_documents does: the row starts life
-- against an in-flight signup (signup_ref) and is claimed — user_id set,
-- signup_ref cleared — when the account is written.

CREATE TABLE IF NOT EXISTS public.identity_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.itd_users(id) ON DELETE CASCADE,
  signup_ref uuid,
  -- 'gstin' is here from the start so a fresh database needs this file alone.
  -- add_gstin_identity_kind.sql widens the same constraint for a database that
  -- already ran an earlier copy of this migration; on a fresh one it is a
  -- no-op. Either order works, and running both twice changes nothing.
  kind text NOT NULL CHECK (kind IN ('aadhaar', 'pan', 'gstin')),
  document_no text NOT NULL,
  -- 'self_declared' is here from the start for the same reason 'gstin' is
  -- above: a fresh database needs this file alone.
  -- add_self_declared_identity_status.sql widens the same constraint for a
  -- database that already ran an earlier copy of this migration.
  status text NOT NULL CHECK (status IN ('verified', 'self_declared', 'bypassed')),
  reference_id text,
  verified_name text,
  name_submitted text,
  name_match_result text,
  name_match_score numeric,
  details jsonb,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_verifications_owner_present
    CHECK (user_id IS NOT NULL OR signup_ref IS NOT NULL)
);

-- One verification per kind per owner; re-verifying replaces it.
CREATE UNIQUE INDEX IF NOT EXISTS identity_verifications_user_kind_key
  ON public.identity_verifications (user_id, kind) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_verifications_signup_kind_key
  ON public.identity_verifications (signup_ref, kind) WHERE signup_ref IS NOT NULL;

-- Sweeping abandoned signups reads this, same as the documents table.
CREATE INDEX IF NOT EXISTS identity_verifications_signup_ref_created_idx
  ON public.identity_verifications (signup_ref, created_at) WHERE signup_ref IS NOT NULL;

-- The ops queue: every account that opened on a check somebody switched off.
--
-- Deliberately not `status <> 'verified'`. Aadhaar is self_declared on every
-- personal account by design, so that predicate would match everything and
-- queue nothing. Aadhaar rows are found by kind.
CREATE INDEX IF NOT EXISTS identity_verifications_bypassed_idx
  ON public.identity_verifications (status, created_at DESC)
  WHERE status = 'bypassed';

COMMENT ON TABLE public.identity_verifications IS
  'The identity numbers signup collected, recorded before the matching document is uploaded. GSTIN is confirmed with the GST portal via Cashfree VRS; Aadhaar and PAN are typed by the customer and confirmed only by the document they upload - see status. Owned by user_id once the account exists; by signup_ref while the signup is in flight.';
COMMENT ON COLUMN public.identity_verifications.document_no IS
  'The number that was verified. Plaintext, consistent with account_documents.document_no and kyc_documents.document_no, which already hold the same Aadhaar. Encrypting one copy while two others sit in the clear would buy nothing — if this is ever addressed it has to be all three at once.';
COMMENT ON COLUMN public.identity_verifications.status IS
  'verified = an authority answered yes (GSTIN with the GST portal; also older Aadhaar and PAN rows, from when those had lookups). self_declared = the customer typed it and no authority was asked because for this kind there is none to ask; Aadhaar and PAN are always this, and what backs each is the OCR match against the uploaded document. bypassed = IDENTITY_BYPASS switched off a check that normally runs, so nothing looked at the number at all. A refused check leaves no row.';
COMMENT ON COLUMN public.identity_verifications.reference_id IS
  'Cashfree''s own id for the call, for support tickets. NULL for Aadhaar and PAN, which make no call.';
COMMENT ON COLUMN public.identity_verifications.verified_name IS
  'The name the authority holds against the number: the legal name of the business for GSTIN, and the registered name on older PAN rows from when that lookup existed. This is the authoritative spelling - the name typed on the signup form is not. NULL for Aadhaar and for new PAN rows, where no authority is asked and there is no name of record.';
COMMENT ON COLUMN public.identity_verifications.name_submitted IS
  'GSTIN, and older PAN rows. The name the number was verified against - the account name as it stood at that moment. Account creation refuses to write an account whose name is not this one, so a number cannot be proved under one name and registered under another. NULL on new PAN rows: with no lookup there is no name to have proved it under.';
COMMENT ON COLUMN public.identity_verifications.name_match_result IS
  'Historical, PAN only. DIRECT_MATCH through NO_MATCH, as graded by Cashfree against the account name while the Income Tax lookup existed. Nothing writes this column any more.';
COMMENT ON COLUMN public.identity_verifications.details IS
  'The vendor payload, minus photo_link. Holds the registered business details for GSTIN, and pan_status/aadhaar_seeding_status on older PAN rows. NULL for Aadhaar and for new PAN rows, which have no vendor payload.';
