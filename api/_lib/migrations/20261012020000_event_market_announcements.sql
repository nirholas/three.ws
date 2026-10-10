-- Event Market announcement outbox: drafts the cron writes when a market's
-- lifecycle changes, held for owner review and sent only by
-- api/_lib/event-markets/poster.js once approved. Idempotent.
-- One announcement per kind per market, whatever its status: a rejected draft is
-- a decision, not a slot for the next cron tick to refill.

create table if not exists event_market_announcements (
	id           uuid primary key default gen_random_uuid(),
	market_id    uuid not null references event_markets(id) on delete cascade,
	kind         text not null check (kind in ('opened','locking_soon','odds_shift','resolved')),
	draft_text   text not null,
	card_url     text,
	tags         text[] not null default '{}',
	-- 'posting' is the poster's claim while a send is in flight, so two ticks never send one draft twice.
	status       text not null default 'draft' check (status in ('draft','approved','posting','posted','rejected')),
	baseline     jsonb not null default '{}'::jsonb,
	approved_by  uuid references users(id) on delete set null,
	approved_at  timestamptz,
	posted_at    timestamptz,
	post_url     text,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	unique (market_id, kind)
);

create index if not exists event_market_announcements_status on event_market_announcements (status, created_at);
