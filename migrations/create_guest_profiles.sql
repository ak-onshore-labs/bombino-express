-- The guest's profile: the contact details behind a verified phone number,
-- before that number has an account.
--
-- Additive and idempotent. Nothing is dropped and no existing row changes
-- meaning.
--
-- Run AFTER add_guest_orders.sql.
--
-- ── Why a table, when orders already carry guest_name/guest_email ───────────
--
-- Those columns are a snapshot of what was typed into ONE booking, and they
-- are the right place for it: a docket has to print the name that was given
-- for that parcel. They cannot answer "who is this guest", for two reasons.
--
--   1. A guest exists before their first order does. The number is proved at
--      the start of the booking form, and the identity document is staged
--      against it immediately — if they leave before submitting, there is no
--      order row and nowhere for the name to live.
--   2. Details added afterwards belong to the person, not to a parcel. When a
--      guest fills in their email from the profile screen, writing it onto the
--      newest order alone would leave the same person with an email on one
--      booking and none on the next.
--
-- So this table holds the person; orders keep holding what was declared for
-- each shipment. The write path updates both — see updateGuestContactOnOrders
-- in server/guestProfileDb.ts — so a corrected name reaches the dockets that
-- have not been generated yet.
--
-- ── Identity ───────────────────────────────────────────────────────────────
--
-- Keyed on guest_ref: the same uuid that owns their staged documents
-- (account_documents, identity_verifications, kyc_documents.guest_ref) and
-- their orders. It is minted only by signupRefForPhone, which only ever runs
-- after an OTP on the number, so a row here is always backed by a phone that
-- was proved at least once.
--
-- NOT keyed on phone. A number that opens an account stops being a guest, and
-- the account is then the record; keying on the ref keeps this table out of
-- that transition entirely.

CREATE TABLE IF NOT EXISTS public.guest_profiles (
  guest_ref uuid PRIMARY KEY,
  -- The verified number the ref was minted against. Denormalised so the
  -- profile can be read without joining to an order that may not exist.
  phone text NOT NULL,
  full_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The claim lookup, and the "does this number already have a guest profile"
-- check. Not unique: signupRefForPhone mints a fresh ref whenever the phone on
-- a browser changes, so one number can legitimately have several refs over
-- time (a second device, or a booking abandoned and restarted).
CREATE INDEX IF NOT EXISTS guest_profiles_phone_idx
  ON public.guest_profiles (phone, updated_at DESC);

COMMENT ON TABLE public.guest_profiles IS
  'Contact details for a guest — someone who proved a phone number by OTP but has not opened an account. Keyed on the same guest_ref that owns their staged documents and their orders. Superseded by itd_users once that number opens an account; the row is left in place as the record of how they arrived.';
COMMENT ON COLUMN public.guest_profiles.guest_ref IS
  'The staging ref this guest is known by — signupRef while documents are staged, guestRef once an order exists. Same uuid throughout.';
COMMENT ON COLUMN public.guest_profiles.phone IS
  'The verified number. Proved by OTP before the ref was minted; never taken from a request body without that check.';
COMMENT ON COLUMN public.guest_profiles.full_name IS
  'As given by the guest. Self-declared and unverified — the identity document in kyc_documents is what customs reads.';
