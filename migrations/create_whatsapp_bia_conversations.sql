-- WhatsApp BIA: one conversation per WhatsApp number.
--
-- Additive and idempotent. Creates one table; nothing existing changes.
--
-- BIA on WhatsApp (server/whatsappBia.ts) knows who it is talking to from the
-- sender's number, which WhatsApp itself has verified. This table holds what
-- the app keeps in the browser session and support_sessions:
--
--   messages            the recent turns, so a follow-up has its context
--   greeted_at          when the one-time "I can see your account" note went
--   identity_declined   the person tapped "Not you?": answer as a visitor
--   recent_message_ids  WhatsApp message ids already answered (Tata retries)
--   window_*            the per-number hourly message limit
--
-- Keyed on the number as WhatsApp sends it (E.164 digits, no plus). Service
-- role only: RLS on, no policies.
--
-- The server fails soft until this has run: it keeps the same state in memory,
-- which is lost on restart and not shared between instances.

CREATE TABLE IF NOT EXISTS public.whatsapp_bia_conversations (
  wa_number          text PRIMARY KEY,
  messages           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  greeted_at         timestamptz,
  identity_declined  boolean     NOT NULL DEFAULT false,
  recent_message_ids text[]      NOT NULL DEFAULT '{}',
  window_started_at  timestamptz,
  window_count       integer     NOT NULL DEFAULT 0,
  last_inbound_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_bia_conversations ENABLE ROW LEVEL SECURITY;
