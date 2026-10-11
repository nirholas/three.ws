-- Migration: per-agent mention-reply policy columns on agent_x_policies.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261011220000_agent_mention_policy.sql
-- Idempotent.
--
-- Whether an agent answers mentions of its own X account, in dry run or live,
-- how many replies a day, and which intents (x-mention-intents.js: chat,
-- make, image3d, avatar) it may act on. These columns join agent_x_policies
-- (20260922190000_account_social_sso.sql) rather than a new table, since the
-- owner edits outbound posting and mention replies in the same settings
-- panel and saveAgentPolicy() in api/_lib/x-agent-policy.js already owns the
-- upsert for that row. Decisions themselves are read from x_mention_events
-- (20261008170000_x_mention_events.sql), which already carries account_kind
-- 'agent' / account_ref = agent id for exactly this purpose.

alter table agent_x_policies
	add column if not exists mention_replies_enabled boolean not null default false,
	add column if not exists mention_replies_dry_run boolean not null default true,
	add column if not exists mention_replies_daily_cap integer not null default 10 check (mention_replies_daily_cap between 0 and 50),
	add column if not exists mention_replies_allowed_intents text[] not null default '{}';
