-- Ops guest KYC viewer: attribute a view to a guest_ref, not an itd_users id.
--
-- Additive only, idempotent. Guests have no itd_users row, so
-- document_access_log.user_id (FK to itd_users) cannot name them — putting a
-- guest uuid there is a 23503 and fail-closes the view.
--
-- NO FK to guest_profiles: claiming deletes the profile, and a dangling uuid
-- is the audit record of who was viewed. ON DELETE SET NULL would wipe that.

DO $$
BEGIN
  IF to_regclass('public.document_access_log') IS NULL THEN
    RAISE NOTICE
      'document_access_log does not exist yet - nothing to widen. Run add_document_access_log.sql first.';
    RETURN;
  END IF;

  ALTER TABLE public.document_access_log
    ADD COLUMN IF NOT EXISTS guest_ref uuid;

  COMMENT ON COLUMN public.document_access_log.guest_ref IS
    'Owner of a guest-owned document (the same uuid as guest_profiles.guest_ref / kyc_documents.guest_ref). NULL on customer views and capability-URL fetches. No FK — claiming deletes the profile and the uuid must remain.';

  RAISE NOTICE 'document_access_log now has guest_ref.';
END $$;

CREATE INDEX IF NOT EXISTS document_access_log_guest_ref_idx
  ON public.document_access_log (guest_ref, accessed_at DESC)
  WHERE guest_ref IS NOT NULL;
