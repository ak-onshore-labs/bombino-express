-- Undo migrations/create_support_cases.sql.
--
-- Support cases (BIA 3.0, packages 4.1 and 4.2: escalations opening a case,
-- the ops Cases tab, replies to the customer's bell) were dropped from the
-- build on 2026-09-12, after create_support_cases.sql had already been run.
-- Nothing reads or writes these any more. Escalating shows the WhatsApp and
-- call buttons, as it did before.
--
-- Safe to run: the table was never switched on (the handoff module was off),
-- so it should be empty. Check first:
--   select count(*) from public.support_cases;

drop table if exists public.support_cases;
drop sequence if exists public.support_case_no_seq;
