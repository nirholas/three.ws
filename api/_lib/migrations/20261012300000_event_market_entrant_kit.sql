-- Event Markets entrant amplification kit (brief 06). Apply:
--   node scripts/apply-migrations.mjs --apply --file 20261012300000_event_market_entrant_kit.sql
-- Idempotent. Needs the core event_markets table and users.
--
--   event_market_pick_referrals   which share link a pick arrived through, one row
--                                 per (market, account), written on the account's
--                                 first pick in that market
--   event_market_point_credits    insert-only ledger of referral points; the
--                                 partial unique index is what makes a referral
--                                 credit once per referred account, ever
--   event_market_entrant_notices  one row per (market, account) once the entrant
--                                 was told they are in the market: never twice
--   event_market_entrant_prefs    an entrant's opt-out from being tagged or
--                                 featured, read by notifications, the profile
--                                 surface and the announcement drafter

begin;

create table if not exists event_market_pick_referrals (
	market_id    uuid not null references event_markets(id) on delete cascade,
	account_id   uuid not null references users(id) on delete cascade,
	referrer_id  uuid not null references users(id) on delete cascade,
	created_at   timestamptz not null default now(),
	primary key (market_id, account_id),
	check (referrer_id <> account_id)
);
create index if not exists event_market_pick_referrals_referrer on event_market_pick_referrals(market_id, referrer_id);

create table if not exists event_market_point_credits (
	id                   uuid primary key default gen_random_uuid(),
	account_id           uuid not null references users(id) on delete cascade,
	kind                 text not null check (kind in ('referral')),
	points               int not null check (points > 0),
	market_id            uuid references event_markets(id) on delete set null,
	referred_account_id  uuid references users(id) on delete set null,
	created_at           timestamptz not null default now()
);
create unique index if not exists event_market_credits_referral_once
	on event_market_point_credits(referred_account_id) where kind = 'referral';
create index if not exists event_market_credits_account on event_market_point_credits(account_id, created_at desc);

create table if not exists event_market_entrant_notices (
	market_id    uuid not null references event_markets(id) on delete cascade,
	account_id   uuid not null references users(id) on delete cascade,
	outcome_id   uuid,
	channels     jsonb not null default '{}'::jsonb,
	notified_at  timestamptz not null default now(),
	primary key (market_id, account_id)
);

create table if not exists event_market_entrant_prefs (
	account_id  uuid primary key references users(id) on delete cascade,
	opt_out     boolean not null default false,
	updated_at  timestamptz not null default now()
);

commit;
