-- GSTIN joins Aadhaar and PAN as a verified identity number.
--
-- Additive only, idempotent, and order-independent.
--
-- This file only WIDENS the kind constraint on a database that already ran an
-- earlier copy of add_identity_verifications.sql, back when the constraint
-- named two kinds. That migration now creates the table with all three, so on
-- a fresh database this file has nothing to do and says so instead of failing.
--
-- Run them in either order. Run them twice if you like.
--
-- The GST portal lookup (server/cashfreeIdentity.ts, verifyGstin) confirms the
-- number and returns the registered business, exactly as the PAN lookup does.
-- The certificate uploaded afterwards is then read for the same number — by
-- server/gstCertificate.ts rather than by Cashfree Smart OCR, which has no GST
-- document type at all. The verdicts and the account gate are the same either
-- way, so the row shape does not change: only the set of allowed kinds does.

DO $$
BEGIN
  IF to_regclass('public.identity_verifications') IS NULL THEN
    RAISE NOTICE
      'identity_verifications does not exist yet - nothing to widen. Run add_identity_verifications.sql, which already allows gstin.';
    RETURN;
  END IF;

  ALTER TABLE public.identity_verifications
    DROP CONSTRAINT IF EXISTS identity_verifications_kind_check;

  ALTER TABLE public.identity_verifications
    ADD CONSTRAINT identity_verifications_kind_check
    CHECK (kind IN ('aadhaar', 'pan', 'gstin'));

  COMMENT ON COLUMN public.identity_verifications.name_submitted IS
    'PAN and GSTIN only. The name the number was verified against - the account name as it stood at that moment. Account creation refuses to write an account whose name is not this one, so a number cannot be proved under one name and registered under another.';

  COMMENT ON COLUMN public.identity_verifications.verified_name IS
    'The name the authority holds against the number: UIDAI''s for Aadhaar, the registered name for PAN, the legal name of the business for GSTIN. This is the authoritative spelling - the name typed on the signup form is not.';

  RAISE NOTICE 'identity_verifications.kind now allows aadhaar, pan, gstin.';
END $$;
