-- Withdrawal payout idempotency: persist every signed transaction BEFORE it is
-- broadcast so a failure after broadcast can be reconciled against the chain
-- instead of being recorded as `failed` while funds may already have moved.
--
-- New status `broadcast_unconfirmed` (agent_withdrawals.status is free text with
-- no check constraint): the signed transaction may have reached the network but
-- was not confirmed. The balance stays reserved until the reconciler proves the
-- outcome. Additive only; idempotent.
begin;

alter table agent_withdrawals
    add column if not exists send_signature          text,
    add column if not exists send_attempts           jsonb not null default '[]'::jsonb,
    add column if not exists send_attempted_at       timestamptz,
    add column if not exists last_valid_block_height bigint,
    add column if not exists send_nonce              bigint;

-- The reconciler scans only rows that still await an on-chain verdict.
create index if not exists agent_withdrawals_awaiting_chain
    on agent_withdrawals (updated_at)
    where status in ('processing', 'broadcast_unconfirmed');

commit;
