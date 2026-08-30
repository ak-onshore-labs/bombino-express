-- Who read which identity document, and when.
--
-- The capability URLs that serve KYC and account documents are bearer tokens:
-- the unguessable id in the path IS the authorisation, there is no session
-- behind it, and it does not expire. That is a deliberate trade — ITD stores
-- the URL in a docket and re-fetches it later — but it means a leaked URL is
-- permanent, silent access to somebody's Aadhaar card.
--
-- This does not close that. It makes it visible. Under the DPDP Act a Data
-- Fiduciary has to notify the Board and the affected people of a personal data
-- breach, and "we cannot tell who read what" makes that impossible to do
-- honestly. Every fetch lands here.
--
-- Deliberately NOT storing the document bytes, the document number, or
-- anything decrypted. A log that leaks is not supposed to be a second copy of
-- the thing it is logging access to.
--
-- Additive only, idempotent, and independent of the other migrations.

CREATE TABLE IF NOT EXISTS public.document_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which store the capability id belongs to: 'kyc' or 'account'.
  source text NOT NULL CHECK (source IN ('kyc', 'account')),
  -- The capability id from the URL. Kept even when it matches no document, so
  -- somebody probing for valid ids is visible rather than silently 404'd.
  capability_id text NOT NULL,
  -- Null when the id matched nothing.
  document_id uuid,
  user_id uuid REFERENCES public.itd_users(id) ON DELETE SET NULL,
  -- 'served' or 'not_found'.
  outcome text NOT NULL CHECK (outcome IN ('served', 'not_found')),
  requester_ip text,
  user_agent text,
  referer text,
  accessed_at timestamptz NOT NULL DEFAULT now()
);

-- The two questions anyone asks of this: what happened to one document, and
-- what has this address been doing.
CREATE INDEX IF NOT EXISTS document_access_log_capability_idx
  ON public.document_access_log (capability_id, accessed_at DESC);

CREATE INDEX IF NOT EXISTS document_access_log_ip_idx
  ON public.document_access_log (requester_ip, accessed_at DESC);

-- Probing shows up as a run of these from one address.
CREATE INDEX IF NOT EXISTS document_access_log_not_found_idx
  ON public.document_access_log (accessed_at DESC)
  WHERE outcome = 'not_found';

COMMENT ON TABLE public.document_access_log IS
  'Every fetch of an identity document through a capability URL. Exists so a leaked URL is detectable and a DPDP breach notification can say what was actually accessed. Holds no document content and no document numbers.';
COMMENT ON COLUMN public.document_access_log.capability_id IS
  'The id presented in the URL, recorded whether or not it matched a document, so probing for valid ids is visible.';
COMMENT ON COLUMN public.document_access_log.requester_ip IS
  'As seen by the app. Behind a proxy this is only as good as Express `trust proxy`, so it is evidence rather than proof.';
