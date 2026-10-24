-- Fix: account_link_codes name collision. The 2026-10-11 account-linking
-- migration's `create table if not exists account_link_codes` silently
-- no-op'd against a same-named table already created by the 2026-09-22
-- agents-v1 migration, so the device-linking feature has been throwing
-- NeonDbError 42703 ("column status does not exist") on every call in
-- production since it shipped. The old table is renamed (not dropped) so its
-- rows survive, then the correctly-shaped table is created in its place.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261024193900_fix_account_link_codes_collision.sql
-- Idempotent.

alter table if exists account_link_codes rename to account_link_codes_agents_v1_legacy;
alter index if exists account_link_codes_user_idx rename to account_link_codes_agents_v1_legacy_user_idx;

create table if not exists account_link_codes (
	id                 uuid primary key default gen_random_uuid(),
	code_hash          text not null unique,
	user_id            uuid not null references users(id) on delete cascade,
	device_kind        text not null check (device_kind in ('phone', 'desktop', 'cli', 'telegram')),
	label              text,
	requested_scope    text,
	status             text not null default 'issued'
	                   check (status in ('issued', 'claimed', 'confirmed', 'rejected', 'consumed', 'expired')),
	claim              jsonb,
	claim_secret_hash  text unique,
	result_kind        text check (result_kind in ('session', 'api_key', 'gateway_link')),
	result_id          uuid,
	result_secret      text,
	device_id          uuid,
	created_at         timestamptz not null default now(),
	expires_at         timestamptz not null,
	claimed_at         timestamptz,
	decided_at         timestamptz,
	consumed_at        timestamptz
);
create index if not exists account_link_codes_user_idx on account_link_codes (user_id, created_at desc);
