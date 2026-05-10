-- Migration: add time_pass_hours and time_pass_amount to agent_skill_prices (C3).
-- Idempotent.
begin;
alter table agent_skill_prices
    add column if not exists time_pass_hours  integer,
    add column if not exists time_pass_amount bigint;
commit;
