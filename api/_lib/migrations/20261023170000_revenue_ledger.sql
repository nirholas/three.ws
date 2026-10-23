-- Revenue ledger and reinvest rules: one place where every way an agent earns
-- is joined, each row linked to its transaction, plus the owner's standing
-- instructions for what to do with that income.
--
-- revenue_ledger_entries
--   One row per income event, copied (idempotently, keyed by source + the source
--   row's own id) from the table that owns it: creator-fee claims, x402 skill
--   and agent-API sales, completed hires, skill royalties, paid invoices and
--   realised trading PnL. Cash basis: a creator fee is income when it is
--   claimed, because the claim is the transaction. The source tables stay the
--   system of record; the reconcile job proves the ledger still matches them.
--
-- revenue_ledger_settings
--   Per-agent public toggle for the /agents/:id/earnings page. Off by default.
--
-- revenue_reconcile_runs
--   One row per scheduled reconcile: database-side totals per source against
--   the source tables, plus a sample of on-chain signature checks.
--
-- revenue_milestones
--   Which income milestones have already been announced, so each fires once.
--
-- revenue_reinvest_rules / _runs / _legs
--   The owner's split ("20 percent to model credits, 20 percent into a DCA of
--   the agent's own coin, 10 percent to a tools budget, keep the rest"), the
--   per-period run the worker executes under an idempotency key, and the
--   per-leg receipts. A rule only runs after the owner confirmed the exact
--   split and caps (confirmed_hash); any edit clears it.
--
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261023170000_revenue_ledger.sql
-- Idempotent.

begin;

create table if not exists revenue_ledger_entries (
	id               uuid primary key default gen_random_uuid(),
	user_id          uuid not null references users(id) on delete cascade,
	agent_id         uuid references agent_identities(id) on delete set null,
	source           text not null check (source in (
		'creator_fee_claim', 'skill_sale', 'hire', 'skill_royalty', 'invoice', 'trading_pnl'
	)),
	kind             text not null check (kind in ('revenue', 'pnl')),
	source_ref       text not null,
	occurred_at      timestamptz not null,
	asset            text not null,
	amount_atomics   numeric(40, 0) not null,
	decimals         int not null check (decimals between 0 and 18),
	usd              numeric(20, 6),
	usd_basis        text not null default 'unvalued'
	                 check (usd_basis in ('exact', 'event_price', 'sync_price', 'recorded', 'unvalued')),
	usd_price        numeric(20, 6),
	tx_signature     text,
	chain            text not null default 'solana',
	network          text not null default 'mainnet' check (network in ('mainnet', 'devnet')),
	counterparty     text,
	label            text,
	counted          boolean not null default true,
	exclusion_reason text,
	meta             jsonb not null default '{}'::jsonb,
	chain_status     text not null default 'unchecked'
	                 check (chain_status in ('unchecked', 'verified', 'mismatch', 'not_found', 'skipped')),
	chain_checked_at timestamptz,
	chain_detail     text,
	synced_at        timestamptz not null default now(),
	unique (source, source_ref)
);

create index if not exists revenue_ledger_entries_user_time
	on revenue_ledger_entries (user_id, occurred_at desc);
create index if not exists revenue_ledger_entries_agent_time
	on revenue_ledger_entries (agent_id, occurred_at desc);
create index if not exists revenue_ledger_entries_verify_queue
	on revenue_ledger_entries (chain_checked_at nulls first)
	where tx_signature is not null and chain = 'solana' and network = 'mainnet';

create table if not exists revenue_ledger_settings (
	agent_id      uuid primary key references agent_identities(id) on delete cascade,
	user_id       uuid not null references users(id) on delete cascade,
	public_earnings boolean not null default false,
	public_since  timestamptz,
	updated_at    timestamptz not null default now()
);

create table if not exists revenue_reconcile_runs (
	id               uuid primary key default gen_random_uuid(),
	started_at       timestamptz not null default now(),
	finished_at      timestamptz,
	status           text not null default 'running' check (status in ('running', 'clean', 'drift', 'error')),
	entries_total    int not null default 0,
	db_checks        jsonb not null default '[]'::jsonb,
	db_drift_count   int not null default 0,
	chain_checked    int not null default 0,
	chain_mismatches int not null default 0,
	chain_not_found  int not null default 0,
	drift_usd        numeric(20, 6) not null default 0,
	alerted_users    int not null default 0,
	error            text
);

create index if not exists revenue_reconcile_runs_started
	on revenue_reconcile_runs (started_at desc);

create table if not exists revenue_milestones (
	id          uuid primary key default gen_random_uuid(),
	user_id     uuid not null references users(id) on delete cascade,
	scope       text not null,
	milestone   text not null,
	usd_at_reach numeric(20, 6),
	reached_at  timestamptz not null default now(),
	unique (scope, milestone)
);

create table if not exists revenue_reinvest_rules (
	id                   uuid primary key default gen_random_uuid(),
	user_id              uuid not null references users(id) on delete cascade,
	agent_id             uuid not null references agent_identities(id) on delete cascade,
	name                 text not null,
	status               text not null default 'draft'
	                     check (status in ('draft', 'active', 'paused')),
	network              text not null default 'mainnet' check (network in ('mainnet', 'devnet')),
	period               text not null default 'weekly' check (period in ('daily', 'weekly', 'monthly')),
	basis                text not null default 'revenue' check (basis in ('revenue', 'revenue_and_trading_profit')),
	legs                 jsonb not null default '[]'::jsonb,
	per_run_cap_usd      numeric(20, 6) not null check (per_run_cap_usd > 0),
	lifetime_cap_usd     numeric(20, 6) not null check (lifetime_cap_usd > 0),
	min_run_usd          numeric(20, 6) not null default 1 check (min_run_usd >= 0),
	confirmed_hash       text,
	confirmed_at         timestamptz,
	paused_reason        text,
	consecutive_failures int not null default 0,
	active_from          timestamptz,
	created_at           timestamptz not null default now(),
	updated_at           timestamptz not null default now()
);

create index if not exists revenue_reinvest_rules_user on revenue_reinvest_rules (user_id, created_at desc);
create index if not exists revenue_reinvest_rules_agent on revenue_reinvest_rules (agent_id);
create index if not exists revenue_reinvest_rules_active on revenue_reinvest_rules (status) where status = 'active';

create table if not exists revenue_reinvest_runs (
	id               uuid primary key default gen_random_uuid(),
	rule_id          uuid not null references revenue_reinvest_rules(id) on delete cascade,
	user_id          uuid not null references users(id) on delete cascade,
	agent_id         uuid not null references agent_identities(id) on delete cascade,
	mode             text not null default 'live' check (mode in ('live', 'preview')),
	period_start     timestamptz not null,
	period_end       timestamptz not null,
	idempotency_key  text not null unique,
	status           text not null default 'running'
	                 check (status in ('running', 'completed', 'partial', 'awaiting_approval', 'skipped', 'failed')),
	base_usd         numeric(20, 6) not null default 0,
	base_breakdown   jsonb not null default '{}'::jsonb,
	planned_usd      numeric(20, 6) not null default 0,
	executed_usd     numeric(20, 6) not null default 0,
	kept_usd         numeric(20, 6) not null default 0,
	rule_snapshot    jsonb not null default '{}'::jsonb,
	note             text,
	error            text,
	started_at       timestamptz not null default now(),
	finished_at      timestamptz
);

create unique index if not exists revenue_reinvest_runs_one_live_per_period
	on revenue_reinvest_runs (rule_id, period_start) where mode = 'live';
create index if not exists revenue_reinvest_runs_rule on revenue_reinvest_runs (rule_id, started_at desc);
create index if not exists revenue_reinvest_runs_user on revenue_reinvest_runs (user_id, started_at desc);

create table if not exists revenue_reinvest_legs (
	id               uuid primary key default gen_random_uuid(),
	run_id           uuid not null references revenue_reinvest_runs(id) on delete cascade,
	leg_key          text not null,
	kind             text not null check (kind in ('model_credits', 'dca_own_coin', 'tools_budget')),
	pct              numeric(7, 4) not null,
	planned_usd      numeric(20, 6) not null default 0,
	capped_usd       numeric(20, 6) not null default 0,
	status           text not null default 'planned'
	                 check (status in ('planned', 'skipped', 'awaiting_approval', 'executed', 'failed')),
	idempotency_key  text not null unique,
	destination      text,
	asset            text,
	amount_atomics   numeric(40, 0),
	signature        text,
	approval_id      uuid,
	detail           jsonb not null default '{}'::jsonb,
	error            text,
	executed_at      timestamptz,
	created_at       timestamptz not null default now(),
	unique (run_id, leg_key)
);

create index if not exists revenue_reinvest_legs_approval on revenue_reinvest_legs (approval_id) where approval_id is not null;

commit;
