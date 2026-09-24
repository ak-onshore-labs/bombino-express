-- Account applications: signup, held for the Bombino team to review.
--
-- Additive and idempotent. Two new tables; nothing existing is altered.
--
-- ── Why ────────────────────────────────────────────────────────────────────
--
-- Until now finishing signup wrote an itd_users row on the spot, under a
-- synthetic 'local-<uuid>' id, with no ITD login behind it. With ACCOUNT_REVIEW
-- on, it files one of these instead. The team reviews it in the ops console,
-- creates the customer and its login in ITD by hand (ITD has no API that issues
-- a login), and types that login in to approve. Only then does the itd_users
-- row exist. See server/accountApproval.ts.
--
-- While an application is open the customer is a guest on the same number:
-- `signup_ref` is the uuid their staged documents, identity numbers, guest
-- profile and guest orders already hang off. Approval moves all of it onto the
-- new account, exactly as signup used to.
--
-- ── What is kept where ─────────────────────────────────────────────────────
--
-- `details` is the form as submitted: name, email, company, GSTIN, address,
-- hub, contact person, the category's extras. A snapshot, so the reviewer reads
-- what the customer sent even if they later edit their guest profile.
--
-- No password is ever stored here. The ITD password lives only where it always
-- has, encrypted on itd_users (itd_password_encrypted + encryption_iv).
--
-- The server fails soft until this has run: with ACCOUNT_REVIEW off (the
-- default) nothing reads these tables, and with it on a failed insert refuses
-- the signup with a retryable error rather than opening an account unreviewed.

CREATE TABLE IF NOT EXISTS public.account_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  signup_ref uuid NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('personal', 'company')),
  company_category text
    CHECK (company_category IS NULL OR company_category IN ('corporate', 'co_courier', 'ecommerce', 'fbb')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- The contract as signed at submission. Copied onto itd_users at approval.
  contract_signed_name text NOT NULL,
  contract_version text NOT NULL,
  contract_accepted_at timestamptz NOT NULL,
  contract_accepted_ip text,

  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_review', 'changes_requested', 'approved', 'rejected', 'withdrawn')),

  -- Review
  reviewer_id uuid REFERENCES public.itd_users (id) ON DELETE SET NULL,
  claimed_at timestamptz,
  requested_changes jsonb,
  decision_note text,
  resubmission_count integer NOT NULL DEFAULT 0,

  -- Approval
  user_id uuid REFERENCES public.itd_users (id) ON DELETE SET NULL,
  itd_customer_id text,
  -- Set when a step after the account was written failed (claiming documents,
  -- orders, the KYC mirror). "Retry" in the console re-runs from there.
  finalize_error text,
  finalized_at timestamptz,
  email_sent_at timestamptz,
  -- Never holds the password: the mailer's error text is scrubbed first.
  email_error text,
  whatsapp_sent_at timestamptz,

  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One open application per number. A second signup on the same phone updates
-- the open one rather than filing another.
CREATE UNIQUE INDEX IF NOT EXISTS account_applications_one_open_per_phone
  ON public.account_applications (phone)
  WHERE status IN ('submitted', 'in_review', 'changes_requested');

-- The ops queue: open applications, oldest first.
CREATE INDEX IF NOT EXISTS account_applications_status_idx
  ON public.account_applications (status, submitted_at);

-- The guest side: "does this ref have an application?"
CREATE INDEX IF NOT EXISTS account_applications_signup_ref_idx
  ON public.account_applications (signup_ref);

COMMENT ON TABLE public.account_applications IS
  'Signup held for review (ACCOUNT_REVIEW). One open row per phone. Approved by an ops user entering the ITD login they created for the customer; see server/accountApproval.ts. Never stores a password.';
COMMENT ON COLUMN public.account_applications.signup_ref IS
  'The guest ref: same uuid as the staged account_documents, identity_verifications, guest_profiles row and guest orders. Approval claims them all onto user_id.';
COMMENT ON COLUMN public.account_applications.details IS
  'The signup form as submitted. What the reviewer reads and what itd_users is written from at approval.';

-- ── History ────────────────────────────────────────────────────────────────
--
-- Insert-only, like order_events: every submission, claim, change request,
-- decision and email, with who did it. The console shows it on the detail page.

CREATE TABLE IF NOT EXISTS public.account_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.account_applications (id) ON DELETE CASCADE,
  event text NOT NULL,
  -- The ops user, or NULL for the customer's own actions.
  actor_id uuid REFERENCES public.itd_users (id) ON DELETE SET NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_application_events_application_idx
  ON public.account_application_events (application_id, created_at);

COMMENT ON TABLE public.account_application_events IS
  'Insert-only history of an account application. Never holds a password.';
