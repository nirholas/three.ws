-- Outbound receipts: chain-resolved enrichment for payment_session_executions.
--
-- payment_session_executions already records what the platform BELIEVES it
-- paid (amount_usdc, payer_address, payee_address as reported by the x402
-- settlement response). These columns hold what the resolver reads straight
-- off the transaction's token-balance diff instead: ground truth, independent
-- of whatever the settlement response claimed. Resolved lazily, on first view
-- of the Outbound receipts tab, then cached here so later views are free.
--
-- resolve_error records a terminal resolve failure (tx not found, tx failed,
-- no matching transfer) so a broken signature is not re-fetched on every page
-- load; resolved_at is null until a resolve attempt (success or error) ran.

alter table payment_session_executions
    add column if not exists resolved_payer         text,
    add column if not exists resolved_payee          text,
    add column if not exists resolved_mint           text,
    add column if not exists resolved_amount_atomics numeric,
    add column if not exists resolved_decimals       smallint,
    add column if not exists resolved_fee_lamports    bigint,
    add column if not exists resolved_slot            bigint,
    add column if not exists resolved_block_time      bigint,
    add column if not exists resolved_at              timestamptz,
    add column if not exists resolve_error            text;

-- Outbound tab lists settled executions for a user, newest first, filterable
-- by resolve state (NULL resolved_at = "not yet resolved" = needs a lazy pass).
create index if not exists pse_user_settled_resolved
    on payment_session_executions (user_id, resolved_at, created_at desc)
    where status = 'settled';
