-- Guest notifications: the in-app bell for someone who booked with a verified
-- phone number and no account.
--
-- Additive and idempotent. One existing constraint is relaxed
-- (notifications.user_id NOT NULL, if the table has it); nothing is dropped and
-- no existing row changes meaning.
--
-- Run AFTER add_guest_orders.sql.
--
-- Same shape as the guest columns on orders, addresses and payments: a row is
-- owned by an account (user_id) or by the guest_ref that booked (guest_ref),
-- never by nobody. server/notify.ts writes a guest's order updates here, and
-- /api/notifications reads them back for a session holding that guest_ref.
-- When the number opens an account, claimGuestOrdersForUser sets user_id on
-- these rows alongside the orders; guest_ref stays as the record of origin.
--
-- The server fails soft until this has run: guest inserts and reads log an
-- error and the bell stays empty. Account notifications are unaffected.

ALTER TABLE public.notifications
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS guest_ref uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_owner_present'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_owner_present
      CHECK (user_id IS NOT NULL OR guest_ref IS NOT NULL);
  END IF;
END $$;

-- The guest's bell: every row for one ref, newest first.
CREATE INDEX IF NOT EXISTS notifications_guest_ref_idx
  ON public.notifications (guest_ref, created_at DESC)
  WHERE guest_ref IS NOT NULL;

COMMENT ON COLUMN public.notifications.guest_ref IS
  'Owns this notification when it was raised for a guest order, in place of user_id. The same uuid as orders.guest_ref. Left in place after claiming, when user_id is set.';
