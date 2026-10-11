-- Developer API plans: subscriptions, checkouts, receipts and a counter table.
--
-- A developer account holds exactly one plan row. The row names the plan in
-- force, the 30-day period it covers, the plan scheduled to replace it when the
-- period ends (a downgrade never takes effect mid-period) and how the next
-- period is paid. The Free plan needs no row: a missing row reads as Free with
-- a period that started at the account's first call.
--
-- A checkout is a priced, time-limited offer to move to a plan. Credits settle
-- it in the same request. USDC and $THREE settle it when the user's own wallet
-- signs the transfer the server built, and `tx_signature` is unique so a replay
-- of the same payment can only ever return the receipt it already produced.
--
-- Counters hold the per-period call count when Redis is not configured, keyed
-- the same way the Redis counter is so the two never drift in shape.
--
-- Keys gain an IP allowlist, a rotation link and an overlap deadline: a
-- rotated key keeps answering until `overlap_until`, then reads as revoked.
--
-- Service layer: api/_lib/dev-plans/*.js, cache: api/_lib/api-key-cache.js.

create table if not exists dev_plan_subscriptions (
	user_id uuid primary key references users(id) on delete cascade,
	plan_id text not null default 'free',
	period_start timestamptz not null default now(),
	period_end timestamptz not null default now() + interval '30 days',
	scheduled_plan_id text,
	renew_with text,
	paid_usd numeric(12, 4) not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists dev_plan_checkouts (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references users(id) on delete cascade,
	plan_id text not null,
	kind text not null,
	asset text not null,
	wallet text,
	pay_to text,
	amount_usd numeric(12, 4) not null,
	amount_atomics numeric(30, 0),
	asset_usd numeric(18, 8),
	price_source text,
	period_start timestamptz not null,
	period_end timestamptz not null,
	status text not null default 'pending',
	tx_signature text unique,
	expires_at timestamptz not null,
	created_at timestamptz not null default now()
);

create index if not exists dev_plan_checkouts_user_idx on dev_plan_checkouts (user_id, created_at desc);

create table if not exists dev_plan_receipts (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references users(id) on delete cascade,
	checkout_id uuid unique references dev_plan_checkouts(id) on delete set null,
	plan_id text not null,
	kind text not null,
	asset text not null,
	amount_usd numeric(12, 4) not null,
	amount_atomics numeric(30, 0),
	tx_signature text,
	ledger_id uuid,
	period_start timestamptz not null,
	period_end timestamptz not null,
	created_at timestamptz not null default now()
);

create index if not exists dev_plan_receipts_user_idx on dev_plan_receipts (user_id, created_at desc);

create table if not exists dev_plan_counters (
	key text primary key,
	n bigint not null default 0,
	expires_at timestamptz not null
);

alter table api_keys add column if not exists ip_allowlist text[];
alter table api_keys add column if not exists rotated_from uuid;
alter table api_keys add column if not exists rotated_to uuid;
alter table api_keys add column if not exists overlap_until timestamptz;
