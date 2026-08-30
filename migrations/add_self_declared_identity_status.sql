-- Aadhaar and PAN are no longer verified with an authority, so
-- identity_verifications needs a status that says exactly that.
--
-- DigiLocker and the Income Tax PAN lookup are both gone
-- (server/cashfreeIdentity.ts). Aadhaar and PAN are now typed by the customer
-- and backed only by the documents they upload, which Smart OCR must read as
-- the same numbers. That is not `verified` — nobody asked UIDAI or the
-- Income Tax Department — and it is not `bypassed` either, which means a
-- check that normally runs was switched off. It is its own thing:
-- `self_declared`.
--
-- Additive only, idempotent, and order-independent — same shape as
-- add_gstin_identity_kind.sql. add_identity_verifications.sql now creates the
-- table with all three statuses, so on a fresh database this file only has the
-- backfill to do and says so instead of failing.
--
-- Run them in either order. Run them twice if you like.

DO $$
BEGIN
  IF to_regclass('public.identity_verifications') IS NULL THEN
    RAISE NOTICE
      'identity_verifications does not exist yet - nothing to widen. Run add_identity_verifications.sql, which already allows self_declared.';
    RETURN;
  END IF;

  -- 1. Widen the status CHECK.
  --
  -- Dropped and recreated rather than added to, because a CHECK constraint
  -- cannot be extended in place.
  ALTER TABLE public.identity_verifications
    DROP CONSTRAINT IF EXISTS identity_verifications_status_check;

  ALTER TABLE public.identity_verifications
    ADD CONSTRAINT identity_verifications_status_check
    CHECK (status IN ('verified', 'self_declared', 'bypassed'));

  -- 2. Repoint the ops queue.
  --
  -- The old index was `WHERE status <> 'verified'`, meaning "every account
  -- that opened on a number nobody checked". With Aadhaar and PAN permanently
  -- self_declared that predicate matches every account ever created, which is
  -- not a queue anybody can work. Narrowed to the case it was built for: a
  -- check that should have run and did not.
  --
  -- self_declared rows are deliberately NOT in this index. They are found by
  -- kind, and they are the expected state rather than an exception.
  DROP INDEX IF EXISTS public.identity_verifications_bypassed_idx;

  CREATE INDEX IF NOT EXISTS identity_verifications_bypassed_idx
    ON public.identity_verifications (status, created_at DESC)
    WHERE status = 'bypassed';

  -- 3. Backfill.
  --
  -- Any Aadhaar or PAN row already written as 'bypassed' was written under
  -- IDENTITY_BYPASS naming that kind, which was the old way of reaching
  -- exactly the flow that is now the only flow: a typed number, unchecked,
  -- matched against the uploaded document. Those rows are self_declared under
  -- the new naming.
  --
  -- Rows written as 'verified' came from DigiLocker or the Income Tax
  -- lookup and are left alone. They record a check that genuinely happened,
  -- and rewriting history to say otherwise would be a lie in the data.
  UPDATE public.identity_verifications
     SET status = 'self_declared',
         updated_at = now()
   WHERE kind IN ('aadhaar', 'pan')
     AND status = 'bypassed';

  COMMENT ON COLUMN public.identity_verifications.status IS
    'verified = an authority answered yes (GSTIN with the GST portal; also older Aadhaar and PAN rows, from when those had lookups). self_declared = the customer typed it and no authority was asked because for this kind there is none to ask; Aadhaar and PAN are always this, and what backs each is the OCR match against the uploaded document. bypassed = IDENTITY_BYPASS switched off a check that normally runs, so nothing looked at the number at all. A refused check leaves no row.';

  RAISE NOTICE 'identity_verifications.status now allows verified, self_declared, bypassed.';
END $$;
