-- Guest chat history: BIA conversations for someone who booked with a verified
-- phone number and no account.
--
-- Additive and idempotent. One existing constraint is relaxed
-- (support_sessions.user_id NOT NULL, if the table has it); nothing is dropped
-- and no existing row changes meaning.
--
-- The same shape as the guest columns on orders, addresses, payments and
-- notifications (add_guest_notifications.sql): a session belongs to an
-- account (user_id) or to the guest_ref that verified the phone (guest_ref),
-- never to nobody. server/appDb.ts reads and writes guest sessions by
-- guest_ref; when the number opens an account, claimGuestOrdersForUser sets
-- user_id on them alongside the orders, and guest_ref stays as the record of
-- origin.
--
-- The table predates the migrations folder, so this was written against the
-- live columns (id, user_id, messages, related_awb, resolved, escalated,
-- session_started_at, session_ended_at, created_at, title, updated_at).
--
-- The server fails soft until this has run: a guest's chat still works, and
-- its history stays in the browser tab as it did before.
--
-- BIA 3.0, package 1.7.

ALTER TABLE public.support_sessions
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.support_sessions
  ADD COLUMN IF NOT EXISTS guest_ref uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.support_sessions'::regclass AND conname = 'support_sessions_owner_present'
  ) THEN
    ALTER TABLE public.support_sessions
      ADD CONSTRAINT support_sessions_owner_present
      CHECK (user_id IS NOT NULL OR guest_ref IS NOT NULL);
  END IF;
END $$;

-- A guest's open conversation: the newest unresolved row for one ref.
CREATE INDEX IF NOT EXISTS support_sessions_guest_ref_idx
  ON public.support_sessions (guest_ref, created_at DESC)
  WHERE guest_ref IS NOT NULL;

COMMENT ON COLUMN public.support_sessions.guest_ref IS
  'Owns this BIA conversation when it was a guest''s, in place of user_id. The same uuid as orders.guest_ref. Left in place after claiming, when user_id is set.';
