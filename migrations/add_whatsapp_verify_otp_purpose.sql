-- WhatsApp reachability.
--
-- 1. 'whatsapp_verify' — the profile "Verify WhatsApp" button sends a code on
--    WhatsApp only, and the customer types it back. Its own purpose so that
--    code can never be spent as a sign-in, and a sign-in code can never mark
--    a number as on WhatsApp.
--
-- 2. An index for getWhatsappReachability (server/whatsappDb.ts), which reads
--    the newest login-code messages for one number on every WhatsApp send and
--    every profile load.
--
-- Additive-only, same shape as add_auth_otp_purpose.sql.

ALTER TABLE public.otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;
ALTER TABLE public.otp_codes ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN ('signup_personal', 'signup_company', 'login', 'auth', 'whatsapp_verify'));

create index if not exists whatsapp_messages_reachability
  on public.whatsapp_messages (to_phone, template, updated_at desc);
