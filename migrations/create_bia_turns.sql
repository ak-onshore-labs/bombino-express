-- BIA turn log: one row per answer BIA gives, for knowing how it is doing.
--
-- What a turn was about (the screen, the error on it, the modules and tools
-- it used), how it went (latency, whether it fell back to a canned reply,
-- tokens), and the customer's thumbs up or down. Written by
-- server/supportTelemetry.ts after the reply has been sent, never delaying it.
--
-- No message text. Not the question, not the answer: the transcript already
-- lives in support_sessions for the customer's own use, and this table is for
-- counting, so it keeps nothing a customer typed.
--
-- Additive and idempotent. Touches no other table. The server fails soft
-- until this has run: turns are simply not recorded, and the thumbs buttons
-- answer "not found".
--
-- BIA 3.0, package 1.6.

create table if not exists public.bia_turns (
  -- Minted by the server before the insert, so the chat reply can carry it
  -- and the thumbs can name it without waiting on this write.
  id                 uuid primary key,
  created_at         timestamptz not null default now(),
  -- The account's support_sessions row, when there is one.
  session_id         uuid,
  owner_kind         text not null check (owner_kind in ('account', 'guest', 'anon')),
  -- Exactly one of these for an account or a guest; neither for anon.
  user_id            uuid,
  guest_ref          uuid,
  -- Where BIA was opened from (shared/biaScreen.ts), already allow-listed.
  surface            text,
  step               text,
  error_code         text,
  modules            text[] not null default '{}',
  tools              text[] not null default '{}',
  card_kinds         text[] not null default '{}',
  latency_ms         integer,
  -- True when BIA could not answer and sent a canned reply.
  fallback           boolean not null default false,
  prompt_tokens      integer,
  completion_tokens  integer,
  rating             smallint check (rating in (-1, 1)),
  rated_at           timestamptz
);

-- Recent turns, for any look at how BIA is doing this week.
create index if not exists bia_turns_created_at_idx
  on public.bia_turns (created_at desc);

-- Only the rated ones, for the helpful rate.
create index if not exists bia_turns_rated_idx
  on public.bia_turns (rated_at desc)
  where rating is not null;

comment on table public.bia_turns is
  'One row per BIA answer: what it was about, how it went, and the rating. No message text. BIA 3.0 package 1.6.';
