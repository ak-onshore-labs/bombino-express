-- BIA's nudges: the few times BIA speaks first, through the bell.
--
-- A daily sweep (POST /api/admin/bia/nudges/sweep, server/supportNudges.ts)
-- sends a bell item when something of the customer's own has stalled: a
-- document check failed, the weighed amount differs from the estimate, a
-- pickup is tomorrow, a guest's signup has sat for a day, a guest has booked
-- a few times without an account. Tapping it opens BIA about that thing.
--
-- Two tables:
--   bia_nudges          one row per nudge sent. Unique per owner, kind and
--                       subject (an order and its date, a document), so the
--                       sweep can run any number of times and send each once.
--                       sent_on keeps it to one nudge per person per day.
--   bia_nudge_optouts   the kinds a customer switched off on Profile or the
--                       guest profile. No row means on.
--
-- Each row belongs to exactly one owner: an account, or the guest_ref a guest
-- booked under (the same ref their bell is keyed on).
--
-- Additive and idempotent. Touches no other table. Until this has run, the
-- sweep answers 503 and sends nothing, and the switches show but can't be
-- saved.
--
-- BIA 3.0, package 5.1.

create table if not exists public.bia_nudges (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid references public.itd_users(id) on delete cascade,
  guest_ref   uuid,
  kind        text not null
              check (kind in ('document_failed', 'amount_changed', 'pickup_tomorrow', 'signup_stuck', 'guest_account')),
  -- What it's about: "{order id}:{pickup date}", "{order id}:{final amount}",
  -- a document's id, a signup's ref, or "once".
  subject     text not null,
  -- The India calendar day it went out, for "one a day".
  sent_on     date not null default ((now() at time zone 'Asia/Kolkata')::date),
  constraint bia_nudges_one_owner check ((user_id is null) <> (guest_ref is null))
);

create unique index if not exists bia_nudges_user_once
  on public.bia_nudges (user_id, kind, subject) where user_id is not null;
create unique index if not exists bia_nudges_guest_once
  on public.bia_nudges (guest_ref, kind, subject) where guest_ref is not null;

-- "Who has had one today?", once per sweep.
create index if not exists bia_nudges_sent_on_idx on public.bia_nudges (sent_on);

create table if not exists public.bia_nudge_optouts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid references public.itd_users(id) on delete cascade,
  guest_ref   uuid,
  kind        text not null
              check (kind in ('document_failed', 'amount_changed', 'pickup_tomorrow', 'signup_stuck', 'guest_account')),
  constraint bia_nudge_optouts_one_owner check ((user_id is null) <> (guest_ref is null))
);

create unique index if not exists bia_nudge_optouts_user_kind
  on public.bia_nudge_optouts (user_id, kind) where user_id is not null;
create unique index if not exists bia_nudge_optouts_guest_kind
  on public.bia_nudge_optouts (guest_ref, kind) where guest_ref is not null;

comment on table public.bia_nudges is
  'Bell nudges BIA sent: owner, kind and subject (unique, so each goes once), and the day it went. BIA 3.0 package 5.1.';
comment on table public.bia_nudge_optouts is
  'Nudge kinds a customer switched off. No row means on. BIA 3.0 package 5.1.';
