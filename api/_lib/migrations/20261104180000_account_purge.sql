-- Migration: account purge receipts, failure tracking, and nullable links on
-- retained financial records.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261104180000_account_purge.sql
-- Idempotent.
--
-- The privacy policy (section 5) promises that a deleted account is purged 30
-- days after the owner deletes it. api/_lib/account-purge.js does that purge and
-- api/cron/purge-deleted-accounts.js runs it daily. This migration gives it:
--
--   account_purge_log       one non-identifying receipt per purged account: a
--                           SHA-256 of the user id, the soft-delete timestamp,
--                           and per-table row counts. No email, wallet or
--                           username. Support can confirm a purge for a known id
--                           by hashing it; nobody can go the other way.
--   account_purge_failures  the retry queue. A user whose purge fails keeps one
--                           row here (attempts, last error code), so the next
--                           tick retries it after the never-attempted accounts
--                           instead of letting one bad account starve the batch.
--                           It cascades away with the user row on success.
--
-- Financial and two-party records (withdrawals, payouts, earnings, transfers,
-- hires, orders, vault positions, subscription payments) must outlive the
-- account for accounting, but each points at the user, or at an agent the user
-- owned, through a NOT NULL column. The purge anonymizes those rows by setting
-- the link to null, so the NOT NULL constraint is dropped here. Every foreign
-- key stays exactly as it is. Columns are matched against the catalog so a
-- branch that lacks one of these tables still applies this cleanly.

create table if not exists account_purge_log (
	id              bigserial   primary key,
	user_hash       text        not null unique,
	soft_deleted_at timestamptz,
	counts          jsonb       not null default '{}'::jsonb,
	r2_objects      int         not null default 0,
	purged_at       timestamptz not null default now()
);

create index if not exists account_purge_log_purged_idx on account_purge_log (purged_at desc);

create table if not exists account_purge_failures (
	user_id         uuid        primary key references users(id) on delete cascade,
	attempts        int         not null default 1,
	last_error      text        not null,
	first_failed_at timestamptz not null default now(),
	last_attempt_at timestamptz not null default now()
);

create index if not exists account_purge_failures_attempt_idx on account_purge_failures (last_attempt_at);

do $$
declare
	target record;
begin
	for target in
		select * from (values
			('agent_withdrawals', 'user_id'),
			('payouts', 'creator_id'),
			('skill_payment_earnings', 'creator_id'),
			('payment_session_executions', 'user_id'),
			('payment_session_executions', 'session_id'),
			('agent_transfers', 'buyer_user_id'),
			('agent_transfers', 'seller_user_id'),
			('agent_transfers', 'agent_id'),
			('human_tasks', 'poster_user_id'),
			('human_tasks', 'poster_agent_id'),
			('event_market_overrides', 'admin_id'),
			('agent_revenue_events', 'agent_id'),
			('agent_revenue_events', 'intent_id'),
			('agent_payments', 'payer_agent_id'),
			('vault_backers', 'backer_agent_id'),
			('vault_backers', 'user_id'),
			('subscription_payments', 'subscription_id'),
			('bundle_purchases', 'bundle_id'),
			('agent_bids', 'worker_user_id'),
			('agent_bounties', 'poster_user_id'),
			('agent_card_withdrawals', 'user_id'),
			('agent_hires', 'hirer_user_id'),
			('agent_jobs', 'worker_user_id'),
			('agent_vaults', 'owner_user_id'),
			('orders', 'user_id'),
			('launch_sponsorships', 'user_id')
		) as t(tbl, col)
	loop
		if exists (
			select 1 from information_schema.columns
			where table_schema = current_schema()
			  and table_name = target.tbl
			  and column_name = target.col
			  and is_nullable = 'NO'
		) then
			execute format('alter table %I alter column %I drop not null', target.tbl, target.col);
		end if;
	end loop;
end
$$;
