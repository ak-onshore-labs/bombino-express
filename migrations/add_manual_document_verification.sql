-- Manual document verification: with account review on, a Bombino reviewer
-- opens and verifies every account document by hand before the account opens.
-- Cashfree Smart OCR is only the first layer: its verdict stays in ocr_status,
-- shown to the reviewer as advice, never replaced.
--
-- Additive and idempotent.
--
--   ocr_verified_by/at    who verified it by hand, and when. Required on every
--                         document before approval (server/accountApproval.ts);
--                         cleared when the customer uploads a new file. Also
--                         logged in the application's history (event
--                         'document_verified', with Cashfree's verdict).
--
--   ocr_status 'manual'   allowed by the CHECK below but no longer written: an
--                         earlier draft stored staff verification there. Harmless.
--
-- Run AFTER add_kyc_ocr_verification.sql. Only account_documents: shipment KYC
-- (kyc_documents) is not reviewed this way.

-- Replace whichever CHECK currently guards ocr_status (its name depends on
-- which earlier file created or widened it) with one that allows 'manual'.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.account_documents'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%ocr_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.account_documents DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.account_documents
  ADD CONSTRAINT account_documents_ocr_status_check
    CHECK (ocr_status IS NULL OR ocr_status IN ('match', 'unreadable', 'unavailable', 'skipped', 'bypassed', 'manual'));

ALTER TABLE public.account_documents
  ADD COLUMN IF NOT EXISTS ocr_verified_by uuid REFERENCES public.itd_users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ocr_verified_at timestamptz;

COMMENT ON COLUMN public.account_documents.ocr_status IS
  'Outcome of the Cashfree Smart OCR check, or ''manual'' when a Bombino reviewer marked it verified (see ocr_verified_by/at). No row is ever stored with a mismatched, wrong-type or tampered result: those uploads are refused. NULL on rows written before this column existed.';
COMMENT ON COLUMN public.account_documents.ocr_verified_by IS
  'The ops user who marked this document verified by hand (ocr_status = ''manual'').';
