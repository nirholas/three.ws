-- Migration: add error_message column to agent_withdrawals for failure details.
-- Idempotent.
begin;
alter table agent_withdrawals
    add column if not exists error_message text;
commit;
