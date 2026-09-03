-- Ops KYC viewer: who looked, and identity-number access.
--
-- Additive only, idempotent. The original document_access_log records
-- capability-URL fetches (no session, so no actor). Ops super_admin views
-- need the viewing staff id and a source for identity numbers, which have
-- no capability UUID.
--
-- Existing inserts (capability URLs) omit actor_user_id and action; those
-- columns are nullable so those callers keep working.

DO $$
BEGIN
  IF to_regclass('public.document_access_log') IS NULL THEN
    RAISE NOTICE
      'document_access_log does not exist yet - nothing to widen. Run add_document_access_log.sql first.';
    RETURN;
  END IF;

  ALTER TABLE public.document_access_log
    ADD COLUMN IF NOT EXISTS actor_user_id uuid
      REFERENCES public.itd_users(id) ON DELETE SET NULL;

  ALTER TABLE public.document_access_log
    ADD COLUMN IF NOT EXISTS action text
      CHECK (action IS NULL OR action IN ('view', 'download'));

  ALTER TABLE public.document_access_log
    ALTER COLUMN capability_id DROP NOT NULL;

  ALTER TABLE public.document_access_log
    DROP CONSTRAINT IF EXISTS document_access_log_source_check;

  ALTER TABLE public.document_access_log
    ADD CONSTRAINT document_access_log_source_check
    CHECK (source IN ('kyc', 'account', 'identity'));

  COMMENT ON COLUMN public.document_access_log.actor_user_id IS
    'The staff user who viewed the document through an authenticated ops endpoint. NULL on capability-URL fetches, which have no session.';
  COMMENT ON COLUMN public.document_access_log.action IS
    'view or download for ops reads. NULL on capability-URL fetches.';

  RAISE NOTICE 'document_access_log now has actor_user_id, action, identity source, nullable capability_id.';
END $$;

CREATE INDEX IF NOT EXISTS document_access_log_actor_idx
  ON public.document_access_log (actor_user_id, accessed_at DESC);
