-- Ops settings: small values the Bombino team changes from the ops console.
--
-- Additive and idempotent. One new table; nothing existing is altered.
--
-- First (and so far only) key:
--
--   application_alert_emails   jsonb array of addresses that get an email when
--                              a new account application arrives, or a customer
--                              sends back the changes they were asked for.
--                              Set from the Applications page.
--
-- The server fails soft until this has run: it reads the recipients from the
-- APPLICATION_ALERT_EMAILS env var instead, and the console shows them read-only
-- with a note to run this file. See server/opsSettings.ts.

CREATE TABLE IF NOT EXISTS public.ops_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  -- The ops user who last changed it.
  updated_by uuid REFERENCES public.itd_users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ops_settings IS
  'Key/value settings changed from the ops console. See server/opsSettings.ts for the keys.';
