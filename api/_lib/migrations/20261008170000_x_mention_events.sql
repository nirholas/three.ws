-- Migration: record every decision the X mention bot makes.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261008170000_x_mention_events.sql
-- Idempotent.
--
-- One row per mention of one of our X accounts (@trythreews, or an agent's own
-- connected account): what the bot saw, which intent the pure parser gave it,
-- what the bot decided, and what it replied or, in dry-run mode, would have
-- replied. The tweet id is the primary key, so a mention read twice by two
-- overlapping polls is recorded once and handled once. The same rows feed the
-- per-author rate limits, the dry-run review console, the per-agent settings
-- preview and the mention-bot health check.
--
-- decision is null while a mention is received but not yet decided. Polling
-- cursors live in app_settings under x_mentions_cursor:<kind>:<ref>, not here.

create table if not exists x_mention_events (
	tweet_id           text        primary key,
	account_kind       text        not null check (account_kind in ('company', 'agent')),
	account_ref        text        not null,
	author_id          text        not null,
	author_username    text,
	conversation_id    text,
	mention_text       text,
	mention_created_at timestamptz,
	intent             text        not null check (intent in ('make', 'image3d', 'avatar', 'help', 'launch', 'chat', 'ignore')),
	args               jsonb       not null default '{}'::jsonb,
	decision           text        check (decision in ('reply', 'skip', 'rate_limited', 'unsafe', 'budget', 'error', 'pending', 'paused')),
	reason             text,
	reply_text         text,
	reply_media_url    text,
	reply_link         text,
	reply_tweet_id     text,
	dry_run            boolean     not null default true,
	creation_id        text,
	error              text,
	created_at         timestamptz not null default now(),
	decided_at         timestamptz,
	replied_at         timestamptz,
	updated_at         timestamptz not null default now()
);

create index if not exists x_mention_events_author_time_idx on x_mention_events (author_id, created_at desc);
create index if not exists x_mention_events_account_time_idx on x_mention_events (account_kind, account_ref, created_at desc);
create index if not exists x_mention_events_decision_time_idx on x_mention_events (decision, created_at desc);
