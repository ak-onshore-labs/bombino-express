-- App settings — a general key/value store for ops-editable config.
--
-- S1 (this slice) stores the office phone and support WhatsApp number that
-- used to be hardcoded across the customer and rider apps. The table is
-- shaped for Phase 2's S2 toggles as well: `value` is jsonb so a string
-- (a phone number) and a boolean (guest-booking on/off) share one store.
--
-- Visibility is NOT a column. A server-side registry decides which keys
-- may leave on GET /api/settings (public) versus GET /api/ops/settings
-- (super_admin). Putting visibility in the database would let a stray
-- INSERT leak a payments-test-mode flag on the public endpoint.
--
-- `updated_at` / `updated_by` are S2's "who last changed it and when"
-- (last-write, not history). S4's change-log table is a later slice.
--
-- Additive only. No renames, no drops, no type changes. Fully idempotent.
-- Seeded values match the literals that were compiled into the apps
-- (`tel:+912266400000`, `phone=917045999553`). ON CONFLICT DO NOTHING so
-- a re-run never overwrites an ops edit.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.itd_users(id) ON DELETE SET NULL
);

INSERT INTO public.app_settings (key, value)
VALUES
  ('support_office_phone', '"2266400000"'::jsonb),
  ('support_whatsapp',     '"917045999553"'::jsonb)
ON CONFLICT (key) DO NOTHING;
