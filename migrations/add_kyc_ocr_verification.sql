-- Smart OCR verification of uploaded identity documents (server/cashfreeOcr.ts).
-- Additive only.
--
-- Run AFTER add_account_categories_and_documents.sql — account_documents has
-- to exist first.
--
-- Documents that contradict the number the customer typed never reach these
-- columns: that upload is refused outright. What is stored is the record of
-- everything that *was* accepted, and on what basis:
--
--   match       OCR read the document and it agreed
--   unreadable  Cashfree answered but could not extract — blur, glare, a bad scan
--   unavailable no answer at all — not configured, timed out, no VRS balance, 5xx
--   skipped     nothing for OCR to check (GST certificate, a utility bill)
--   bypassed    OCR_BYPASS=1 — the check was deliberately not run at all
--
-- 'bypassed' is a fifth value rather than a reuse of one of the four because a
-- document accepted while verification was switched off is not the same thing
-- as one nothing checks ('skipped'), one that could not be read
-- ('unreadable'), or one whose verifier gave no answer ('unavailable'). Only
-- 'bypassed' means the number on the document was never compared with the
-- number of record, and ops has to be able to find exactly those rows.
--
-- On a database that already has the column this file is a no-op — ADD COLUMN
-- IF NOT EXISTS does not revisit the CHECK. Such a database was widened by
-- add_ocr_bypassed_status.sql, which existed only for that purpose and is gone
-- now that a fresh database gets all five values from the start.
--
-- The three non-match values are the ops queue: those documents went in
-- unverified, and a human still has to look at them.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account_documents', 'kyc_documents'] LOOP
    EXECUTE format($f$
      ALTER TABLE public.%I
        ADD COLUMN IF NOT EXISTS ocr_status text
          CHECK (ocr_status IN ('match', 'unreadable', 'unavailable', 'skipped', 'bypassed')),
        ADD COLUMN IF NOT EXISTS ocr_verification_id text,
        ADD COLUMN IF NOT EXISTS ocr_reference_id bigint,
        ADD COLUMN IF NOT EXISTS ocr_document_fields jsonb,
        ADD COLUMN IF NOT EXISTS ocr_quality_checks jsonb,
        ADD COLUMN IF NOT EXISTS ocr_fraud_checks jsonb,
        ADD COLUMN IF NOT EXISTS ocr_checked_at timestamptz
    $f$, t);
  END LOOP;
END $$;

-- The ops queue: everything accepted without a clean OCR read.
CREATE INDEX IF NOT EXISTS account_documents_ocr_unverified_idx
  ON public.account_documents (ocr_status, created_at DESC)
  WHERE ocr_status IS DISTINCT FROM 'match';

CREATE INDEX IF NOT EXISTS kyc_documents_ocr_unverified_idx
  ON public.kyc_documents (ocr_status, created_at DESC)
  WHERE ocr_status IS DISTINCT FROM 'match';

COMMENT ON COLUMN public.account_documents.ocr_status IS
  'Outcome of the Cashfree Smart OCR check. No row is ever stored with a mismatched, wrong-type or tampered result — those uploads are refused. NULL on rows written before this column existed.';
COMMENT ON COLUMN public.account_documents.ocr_document_fields IS
  'Raw extraction from Cashfree. May hold a masked Aadhaar (XXXXXXXX1234) — the document itself discloses no more than that.';
COMMENT ON COLUMN public.account_documents.ocr_fraud_checks IS
  'Cashfree fraud signals. is_photo_imposed / is_overwritten / is_forged refuse the upload; is_screenshot and is_photo_of_screen are recorded but tolerated, being too common among honest customers to block on.';

COMMENT ON COLUMN public.kyc_documents.ocr_status IS
  'Outcome of the Cashfree Smart OCR check. See account_documents.ocr_status.';
