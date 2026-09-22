-- Account surfaces: per-agent X accounts and posting policy, and linked sign-in
-- identities (Google). docs/authentication.md and docs/x-posting-policy.md are
-- the user-facing guides; api/_lib/x-agent-policy.js and api/_lib/identities.js
-- are the only writers.
--
--   agent_x_connections   an X account connected to ONE agent, so an agent can
--                         post as itself instead of as its owner. Tokens are
--                         AES-GCM encrypted exactly like social_connections.
--                         An agent without a row posts through its owner's
--                         account (social_connections), if the policy allows.
--   agent_x_policies      what an agent may post, how often, whether a human
--                         approves each post first, and the tone rules the
--                         content check enforces. One row per agent; an agent
--                         with no row uses the defaults in x-agent-policy.js
--                         (review before post, nothing allowed until set).
--   x_pending_reviews     gains kind / source / source_ref so the approval
--                         queue can say why a post exists (a launch, a trade,
--                         a run, a reply) and link back to what produced it,
--                         plus scheduled_for: an approved post with a future
--                         time is scheduled rather than published at once,
--                         and reply_to_tweet_id so an approved reply threads.
--   x_posts, x_scheduled_posts  gain kind so the cadence caps can count by it.
--   user_identities       a sign-in method linked to an account beyond its
--                         original one. `subject` is the provider's stable id
--                         (Google's `sub`); one account per identity, one
--                         identity per provider per account.

create table if not exists agent_x_connections (
	agent_id          uuid primary key references agent_identities(id) on delete cascade,
	user_id           uuid not null references users(id) on delete cascade,
	provider_uid      text not null,
	username          text not null,
	access_token      text not null,
	refresh_token     text,
	expires_at        timestamptz,
	scopes            text not null default '',
	raw_data          jsonb not null default '{}'::jsonb,
	posts_this_month  integer not null default 0,
	month_resets_at   timestamptz not null default (date_trunc('month', now()) + interval '1 month'),
	last_posted_at    timestamptz,
	connected_at      timestamptz not null default now(),
	updated_at        timestamptz not null default now(),
	disconnected_at   timestamptz
);
create index if not exists agent_x_connections_user_idx on agent_x_connections (user_id) where disconnected_at is null;

create table if not exists agent_x_policies (
	agent_id            uuid primary key references agent_identities(id) on delete cascade,
	user_id             uuid not null references users(id) on delete cascade,
	enabled             boolean not null default true,
	allowed_kinds       text[] not null default '{}',
	review_before_post  boolean not null default true,
	max_posts_per_day   integer not null default 4 check (max_posts_per_day between 0 and 50),
	min_interval_min    integer not null default 60 check (min_interval_min between 0 and 1440),
	tone_guidance       text not null default '' check (char_length(tone_guidance) <= 1000),
	banned_terms        text[] not null default '{}',
	max_hashtags        integer not null default 1 check (max_hashtags between 0 and 10),
	allow_links         boolean not null default true,
	created_at          timestamptz not null default now(),
	updated_at          timestamptz not null default now()
);
create index if not exists agent_x_policies_user_idx on agent_x_policies (user_id);

alter table x_pending_reviews add column if not exists kind       text;
alter table x_pending_reviews add column if not exists source     text;
alter table x_pending_reviews add column if not exists source_ref text;
alter table x_pending_reviews add column if not exists scheduled_for timestamptz;
alter table x_pending_reviews add column if not exists reply_to_tweet_id text;
create index if not exists x_pending_reviews_agent_pending_idx
	on x_pending_reviews (agent_id, created_at desc) where status = 'pending';

alter table x_posts           add column if not exists kind text;
alter table x_scheduled_posts add column if not exists kind text;
create index if not exists x_posts_agent_created_idx on x_posts (agent_id, created_at desc) where agent_id is not null;

create table if not exists user_identities (
	id              uuid primary key default gen_random_uuid(),
	user_id         uuid not null references users(id) on delete cascade,
	provider        text not null check (provider in ('google')),
	subject         text not null,
	email           text,
	email_verified  boolean not null default false,
	display_name    text,
	avatar_url      text,
	linked_at       timestamptz not null default now(),
	last_used_at    timestamptz
);
create unique index if not exists user_identities_provider_subject_uidx on user_identities (provider, subject);
create unique index if not exists user_identities_user_provider_uidx on user_identities (user_id, provider);
