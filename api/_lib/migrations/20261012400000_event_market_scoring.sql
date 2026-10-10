-- Migration: Event Markets scoring, season stats and season reward proposals.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261012400000_event_market_scoring.sql
-- Idempotent. Requires event_markets, event_market_picks and users.
--
--   event_market_scores           the settled-pick ledger: one row per (market, account),
--                                 written once by the rollup (insert ... on conflict do
--                                 nothing). An admin override deletes a market's rows and
--                                 the next rollup writes them again from the new result.
--   event_market_stats            per scope (season | all), season and source kind
--                                 ('all' for every kind): calls, hit rate inputs, score,
--                                 average odds at pick, best call, streaks and rank.
--                                 Recomputed from the ledger, so it is replay-safe.
--   event_market_season_payouts   the season-end reward list in $THREE. A row is a
--                                 PROPOSAL (status 'proposed'). Paying it is owner-gated:
--                                 scripts/event-markets-season-payouts.mjs prints the
--                                 table and stops. Nothing here moves funds.
--
-- Library: api/_lib/event-markets/{scoring,rollup,fairness,leaderboard}.js.
-- Docs: docs/event-markets.md (section "Scoring and seasons").

-- placePick stamps each pick with the odds it faced and whether the account may
-- be ranked (api/_lib/event-markets/fairness.js). Safe whichever core migration ran first.
alter table event_market_picks add column if not exists odds_at_pick numeric;
alter table event_market_picks add column if not exists ranked boolean not null default true;
alter table event_markets add column if not exists resolved_at timestamptz;

create table if not exists event_market_scores (
	market_id     uuid        not null references event_markets(id) on delete cascade,
	account_id    uuid        not null references users(id) on delete cascade,
	source_kind   text        not null,
	season_id     text        not null,
	correct       boolean     not null,
	points_staked integer     not null check (points_staked > 0),
	odds_at_pick  numeric(9,8) not null check (odds_at_pick > 0 and odds_at_pick <= 1),
	delta         integer     not null,
	ranked        boolean     not null default true,
	unranked_reason text,
	settled_at    timestamptz not null,
	created_at    timestamptz not null default now(),
	primary key (market_id, account_id)
);
create index if not exists event_market_scores_account on event_market_scores (account_id, settled_at);
create index if not exists event_market_scores_season on event_market_scores (season_id) where ranked;

create table if not exists event_market_stats (
	scope_kind       text    not null check (scope_kind in ('season', 'all')),
	season_id        text    not null default '',
	source_kind      text    not null default 'all',
	account_id       uuid    not null references users(id) on delete cascade,
	calls            integer not null default 0,
	hits             integer not null default 0,
	score            integer not null default 0,
	avg_odds         numeric(9,8),
	best_call_delta  integer not null default 0,
	best_call_market uuid references event_markets(id) on delete set null,
	current_streak   integer not null default 0,
	longest_streak   integer not null default 0,
	rank             integer,
	updated_at       timestamptz not null default now(),
	primary key (scope_kind, season_id, source_kind, account_id)
);
create index if not exists event_market_stats_board on event_market_stats (scope_kind, season_id, source_kind, rank) where rank is not null;

create table if not exists event_market_season_payouts (
	season_id      text    not null,
	account_id     uuid    not null references users(id) on delete cascade,
	rank           integer not null,
	wallet_address text,
	amount         numeric(24,6) not null check (amount >= 0),
	token          text    not null,
	chain          text    not null,
	perk           text,
	status         text    not null default 'proposed' check (status in ('proposed', 'approved', 'paid', 'skipped')),
	note           text,
	tx_signature   text,
	created_at     timestamptz not null default now(),
	updated_at     timestamptz not null default now(),
	primary key (season_id, account_id)
);
create index if not exists event_market_season_payouts_status on event_market_season_payouts (status, season_id);
