-- WhatsApp updates number: for every customer, from any country, by choice.
--
-- whatsapp_alt_numbers (create_whatsapp_alt_numbers.sql) first held an Indian
-- number for customers from abroad whose sign-in number had no WhatsApp.
-- Aditya, 4 Nov 2026: any customer, Indian sign-in numbers included, can add a
-- second WhatsApp number from any country and choose which one gets updates.
--
--   1. alt_phone takes any country: bare 10-digit Indian mobile, or E.164
--      ("+971501234567") for anywhere else, the same forms itd_users.phone uses.
--   2. use_for_updates: true sends updates to alt_phone, false to the sign-in
--      number. Defaults to true: someone who bothered to add a number wants it
--      used. When the sign-in number is known not to be on WhatsApp, updates go
--      to alt_phone whatever this says (server/whatsappAlt.ts).
--
-- Additive and safe to re-run. Until it is applied the app keeps working:
-- Indian alternates save as before, use_for_updates reads as true, and a
-- number from abroad is refused with a clear message.

ALTER TABLE public.whatsapp_alt_numbers
  DROP CONSTRAINT IF EXISTS whatsapp_alt_numbers_alt_phone_check;

ALTER TABLE public.whatsapp_alt_numbers
  ADD CONSTRAINT whatsapp_alt_numbers_alt_phone_check
  CHECK (alt_phone ~ '^[6-9][0-9]{9}$' OR alt_phone ~ '^\+[1-9][0-9]{5,14}$');

ALTER TABLE public.whatsapp_alt_numbers
  ADD COLUMN IF NOT EXISTS use_for_updates boolean NOT NULL DEFAULT true;

COMMENT ON TABLE public.whatsapp_alt_numbers IS
  'A verified second WhatsApp number per sign-in number, any country; use_for_updates picks which one gets updates.';
