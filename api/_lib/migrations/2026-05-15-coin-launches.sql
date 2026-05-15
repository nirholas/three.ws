-- Migration: coin_launches + holders + events + payouts
--
-- Backs the lottery + SOL-reflection coin mechanic.
-- A row in coin_launches represents one pump.fun token whose creator-fee
-- inflow is split into a lottery pot (one winner per draw) and a reflection
-- pot (pro-rata SOL drip to all eligible holders). All payouts are tracked
-- in coin_payouts with idempotent tx_signature uniqueness.
--
-- Idempotent: safe to re-run.

begin;

create table if not exists coin_launches (
	id                       uuid primary key default gen_random_uuid(),
	mint                     text not null unique,                  -- pump.fun token mint pubkey
	name                     text not null,
	symbol                   text not null,
	network                  text not null default 'mainnet',
	creator_wallet           text not null,                         -- wallet receiving pump.fun creator fees
	-- Allocation in basis points (must sum to 10000)
	lottery_bps              integer not null default 7000,
	reflection_bps           integer not null default 2500,
	ops_bps                  integer not null default 500,
	ops_wallet               text,                                  -- where ops cut is sent
	-- Cadence
	draw_interval_seconds    integer not null default 3600,         -- hourly draws
	reflection_interval_seconds integer not null default 3600,      -- hourly reflection batch
	-- Live pot state (lamports = SOL × 1e9)
	lottery_pot_lamports     bigint not null default 0,
	reflection_pot_lamports  bigint not null default 0,
	ops_pot_lamports         bigint not null default 0,
	total_claimed_lamports   bigint not null default 0,
	-- Last-action timestamps
	last_claim_at            timestamptz,
	last_draw_at             timestamptz,
	last_reflection_at       timestamptz,
	last_snapshot_at         timestamptz,
	-- Holder eligibility
	min_holder_balance       bigint not null default 0,             -- in token smallest units
	-- Operational flags
	is_active                boolean not null default true,         -- include in cron sweeps
	is_live                  boolean not null default false,        -- false = dry-run; true = sign + submit
	-- Audit / metadata
	metadata                 jsonb not null default '{}'::jsonb,
	created_at               timestamptz not null default now(),
	updated_at               timestamptz not null default now(),
	check (lottery_bps + reflection_bps + ops_bps = 10000)
);

create index if not exists coin_launches_active on coin_launches(is_active) where is_active;

create table if not exists coin_holders (
	id                              bigserial primary key,
	coin_id                         uuid not null references coin_launches(id) on delete cascade,
	wallet                          text not null,
	balance                         bigint not null default 0,                -- token smallest units, last snapshot
	first_seen                      timestamptz not null default now(),
	last_seen                       timestamptz not null default now(),
	accrued_reflection_lamports     bigint not null default 0,                -- pending payout
	total_reflection_paid_lamports  bigint not null default 0,
	total_lottery_won_lamports      bigint not null default 0,
	last_payout_at                  timestamptz,
	unique(coin_id, wallet)
);

create index if not exists coin_holders_coin_balance
	on coin_holders(coin_id, balance desc) where balance > 0;

create index if not exists coin_holders_wallet on coin_holders(wallet);

create table if not exists coin_events (
	id           bigserial primary key,
	coin_id      uuid not null references coin_launches(id) on delete cascade,
	kind         text not null,                                  -- fee_claim | lottery_draw | reflection_batch | snapshot | error
	payload      jsonb not null default '{}'::jsonb,
	tx_signature text,
	created_at   timestamptz not null default now()
);

create index if not exists coin_events_coin_kind_time
	on coin_events(coin_id, kind, created_at desc);

create index if not exists coin_events_tx_sig
	on coin_events(tx_signature) where tx_signature is not null;

create table if not exists coin_payouts (
	id              bigserial primary key,
	coin_id         uuid not null references coin_launches(id) on delete cascade,
	kind            text not null,                              -- 'lottery' | 'reflection'
	wallet          text not null,
	amount_lamports bigint not null,
	-- Reference to the originating draw/batch (so all reflection payouts in a
	-- single batch share an idempotency key; lottery draws share the draw_id).
	batch_id        text not null,
	tx_signature    text,
	status          text not null default 'pending',            -- pending | submitted | confirmed | failed
	error           text,
	created_at      timestamptz not null default now(),
	submitted_at    timestamptz,
	confirmed_at    timestamptz,
	unique(batch_id, wallet)
);

create index if not exists coin_payouts_coin_status
	on coin_payouts(coin_id, status, created_at);

create index if not exists coin_payouts_wallet on coin_payouts(wallet);

create index if not exists coin_payouts_batch on coin_payouts(batch_id);

-- Drand round commitments (verifiable randomness audit trail).
-- One row per lottery draw: committed at draw start, resolved when the
-- Drand round's randomness is published.
create table if not exists coin_draws (
	id                  bigserial primary key,
	coin_id             uuid not null references coin_launches(id) on delete cascade,
	draw_id             text not null,                          -- caller-defined idempotency key (e.g. "<mint>-<unix_hour>")
	drand_round         bigint not null,                        -- League of Entropy round number used as RNG source
	drand_randomness    text,                                   -- hex randomness once revealed
	drand_signature     text,                                   -- BLS signature for verifier audit
	pot_lamports        bigint not null,                        -- size of the lottery pot at draw time
	weights_hash        text not null,                          -- sha256 of the sorted (wallet, weight) tuples
	holder_count        integer not null default 0,
	winner_wallet       text,
	winner_balance      bigint,
	tx_signature        text,
	status              text not null default 'committed',      -- committed | resolved | paid | failed
	error               text,
	created_at          timestamptz not null default now(),
	resolved_at         timestamptz,
	paid_at             timestamptz,
	unique(coin_id, draw_id)
);

create index if not exists coin_draws_coin_time
	on coin_draws(coin_id, created_at desc);

commit;
