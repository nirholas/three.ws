-- Migration: count the visits three.ws sends to DEXTools pair pages.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261008120000_dextools_referrals.sql
-- Idempotent.
--
-- DEXTools Social Boost ranks tokens by visits to their pair page, so the
-- traffic three.ws routes there is the number the partnership is measured in.
-- Every DEXTools link on the platform goes through GET /api/coin/dextools, which
-- resolves the token's top pool, redirects to its pair page, and bumps one row
-- here per (UTC day, network, token, surface). Aggregated, never per-visitor:
-- no IP, no session, no user id is stored.

create table if not exists dextools_referrals (
	day     date        not null,
	network text        not null,
	token   text        not null,
	surface text        not null,
	visits  integer     not null default 0,
	last_at timestamptz not null default now(),
	primary key (day, network, token, surface)
);

create index if not exists dextools_referrals_token_idx on dextools_referrals (token, day desc);
