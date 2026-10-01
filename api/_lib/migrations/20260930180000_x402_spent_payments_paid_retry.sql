-- Migration: let a buyer charged for a failed call retry it with the same payment.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20260930180000_x402_spent_payments_paid_retry.sql
-- Idempotent.
--
-- x402_spent_payments is the durable replay guard: one row per honoured
-- X-PAYMENT proof, and a second use answers 409 payment_replayed. That was
-- wrong for a streaming route whose handler failed after settlement (and for a
-- SIWX grant write that failed after settlement): the buyer was charged, got
-- nothing, and was told to pay again. These columns record how a proof ended
-- so the paid-endpoint wrapper can tell the two apart:
--
--   outcome      delivered            the work shipped; a replay is a 409.
--                failed_after_settle  charged, work failed; the same header may
--                                     retry (no second verify, no second settle).
--                retrying             a retry is running right now (atomic claim).
--   retry_count  retries taken so far, capped by X402_PAID_RETRY_MAX (default 3).
--   retry_until  the retry window, X402_PAID_RETRY_WINDOW_SECONDS after the first
--                failure (default 24 h).
--   settlement   { transaction, network, payer, asset, amount, header }: what the
--                retry re-emits as x-payment-response and feeds to post-settle hooks.
--   last_error   the failure, for support.
--
-- Every existing row is a delivered proof, which is what the default says.

alter table x402_spent_payments
	add column if not exists outcome text not null default 'delivered',
	add column if not exists retry_count integer not null default 0,
	add column if not exists retry_until timestamptz,
	add column if not exists settlement jsonb,
	add column if not exists last_error text,
	add column if not exists updated_at timestamptz not null default now();

do $$ begin
	alter table x402_spent_payments
		add constraint x402_spent_payments_outcome_check
		check (outcome in ('delivered', 'failed_after_settle', 'retrying'));
exception when duplicate_object then null; end $$;

create index if not exists x402_spent_payments_retryable_idx
	on x402_spent_payments (retry_until)
	where outcome = 'failed_after_settle';
