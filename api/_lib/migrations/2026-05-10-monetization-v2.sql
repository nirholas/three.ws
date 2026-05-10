-- Migration: monetization v2 — trials, time-based access, mint decimals,
-- pending expiry, mismatch handling, A/B-pricing-friendly status enum.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-05-10-monetization-v2.sql
-- Idempotent.

begin;

-- ── agent_skill_prices: cache mint decimals (A2) and trial allowance (C2) ──
alter table agent_skill_prices
	add column if not exists mint_decimals smallint not null default 6,
	add column if not exists trial_uses    integer  not null default 0;

-- ── skill_purchases: add trial / time-window / expiry / mismatch state ────
alter table skill_purchases
	add column if not exists expires_at      timestamptz,                  -- A3 pending TTL
	add column if not exists valid_until     timestamptz,                  -- C3 time-bounded access
	add column if not exists trial_remaining integer,                      -- C2 trial counter
	add column if not exists tipped_amount   bigint,                       -- A6 mismatch-as-tip
	add column if not exists referrer_user_id uuid references users(id),   -- C6 referral attribution
	add column if not exists kind            text not null default 'purchase'
		check (kind in ('purchase', 'trial', 'time_pass'));

-- Expand status to include the new lifecycle states. Drop the old check first.
do $$ begin
	alter table skill_purchases drop constraint skill_purchases_status_check;
exception when undefined_object then null; end $$;

alter table skill_purchases
	add constraint skill_purchases_status_check
	check (status in ('pending', 'confirmed', 'failed', 'expired', 'tipped', 'trial'));

-- The unique-confirmed-per-user index needs to also count 'trial' as ownership
-- so a user can't have both a confirmed purchase AND an active trial duplicating it.
drop index if exists skill_purchases_one_confirmed_per_user;
create unique index if not exists skill_purchases_one_active_per_user
	on skill_purchases (user_id, agent_id, skill)
	where status in ('confirmed', 'trial');

create index if not exists skill_purchases_expires_at
	on skill_purchases (expires_at)
	where status = 'pending' and expires_at is not null;

-- ── purchase_receipts: signed, append-only receipts (C4) ──────────────────
create table if not exists purchase_receipts (
	id            uuid primary key default gen_random_uuid(),
	purchase_id   uuid not null references skill_purchases(id) on delete cascade,
	receipt_json  jsonb not null,
	signature     text not null,                  -- HMAC-SHA256 over canonical receipt_json
	created_at    timestamptz not null default now(),
	unique (purchase_id)
);

create index if not exists purchase_receipts_created_at
	on purchase_receipts (created_at desc);

-- ── purchase_events: funnel telemetry (Phase D / professional grade) ──────
create table if not exists purchase_events (
	id          bigserial primary key,
	purchase_id uuid references skill_purchases(id) on delete cascade,
	event       text not null,
	payload     jsonb not null default '{}'::jsonb,
	created_at  timestamptz not null default now()
);

create index if not exists purchase_events_purchase
	on purchase_events (purchase_id, created_at desc);

create index if not exists purchase_events_event_time
	on purchase_events (event, created_at desc);

-- ── csrf_tokens: lightweight double-submit cookie pattern (A5) ────────────
create table if not exists csrf_tokens (
	token       text primary key,
	user_id     uuid not null references users(id) on delete cascade,
	created_at  timestamptz not null default now(),
	expires_at  timestamptz not null
);

create index if not exists csrf_tokens_user
	on csrf_tokens (user_id, expires_at desc);

create index if not exists csrf_tokens_expires
	on csrf_tokens (expires_at);

commit;
