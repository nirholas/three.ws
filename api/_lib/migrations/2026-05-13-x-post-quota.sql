-- Quota tracking for automated X posts.
-- Free tier: 5 posts per calendar month. Pro tier (via subscriptions table) bypasses.

alter table social_connections add column if not exists posts_this_month   int         not null default 0;
alter table social_connections add column if not exists month_resets_at    timestamptz not null default date_trunc('month', now()) + interval '1 month';

create table if not exists x_posts (
    id              uuid        primary key default gen_random_uuid(),
    user_id         uuid        not null references users(id) on delete cascade,
    agent_id        text,
    tweet_id        text        not null,
    text            text        not null,
    created_at      timestamptz not null default now()
);

create index if not exists x_posts_user_idx  on x_posts(user_id, created_at desc);
create index if not exists x_posts_agent_idx on x_posts(agent_id, created_at desc);
