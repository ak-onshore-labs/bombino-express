-- Support cases: a BIA escalation that reaches someone.
--
-- When a customer needs a person (a damaged or lost parcel, a refund dispute,
-- a customs hold, a complaint), BIA's escalate_support opens a case here
-- instead of only showing the contact buttons. Ops read and answer cases from
-- the console's Cases tab (BIA 3.0 package 4.2), and the answer reaches the
-- customer's bell (4.3).
--
-- One row per case: its number (BIA-1001 onwards), who it belongs to (an
-- account or a guest, never nobody), the order it's about when there is one,
-- a category, a three-line summary, and a snapshot of the conversation as it
-- stood when the case was opened (identity numbers already masked by BIA's
-- privacy filter). Then its status and ops' reply.
--
-- Additive and idempotent. Touches no other table. The server fails soft
-- until this has run: escalating shows the contact buttons as before, and
-- logs one line. Cases are only opened at all once BIA_MODULES includes
-- "handoff".
--
-- Run AFTER create_bia_turns.sql and support_sessions_guest_ref.sql.
--
-- BIA 3.0, package 4.1.

create sequence if not exists public.support_case_no_seq start with 1001;

create table if not exists public.support_cases (
  id               uuid primary key default gen_random_uuid(),
  -- "BIA-1001": what the customer quotes on WhatsApp, and what ops search by.
  case_no          text not null unique default ('BIA-' || nextval('public.support_case_no_seq')::text),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Exactly one owner: an account, or the guest_ref a guest booked under.
  user_id          uuid references public.itd_users(id) on delete cascade,
  guest_ref        uuid,
  -- The order it's about, proved to be the owner's before it was attached.
  order_no         text,
  category         text not null default 'other'
                   check (category in ('damaged', 'lost', 'delayed', 'refund', 'customs', 'rider', 'cancel', 'other')),
  -- Three short lines for ops: what happened, which order, what they want.
  summary          text not null,
  -- [{ role, content }], the conversation when the case was opened.
  transcript       jsonb not null default '[]'::jsonb,
  status           text not null default 'open' check (status in ('open', 'answered', 'closed')),
  ops_reply        text,
  answered_at      timestamptz,
  answered_by      uuid,
  closed_at        timestamptz,
  -- The BIA turn that opened it, to join the turn log.
  turn_id          uuid,
  constraint support_cases_owner_present check (user_id is not null or guest_ref is not null)
);

-- "Is there already an open case for this owner and order?" — the repeat
-- guard in server/supportCases.ts, one query per escalation.
create index if not exists support_cases_user_open_idx
  on public.support_cases (user_id, order_no, created_at desc)
  where status = 'open' and user_id is not null;

create index if not exists support_cases_guest_open_idx
  on public.support_cases (guest_ref, order_no, created_at desc)
  where status = 'open' and guest_ref is not null;

-- The ops queue: by status, newest first.
create index if not exists support_cases_status_idx
  on public.support_cases (status, created_at desc);

comment on table public.support_cases is
  'BIA escalations ops can see and answer: case number, owner, order, category, summary, transcript snapshot, status and reply. BIA 3.0 package 4.1.';
