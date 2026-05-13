-- Scheduled X posts. Cron runs every minute and publishes due posts that
-- belong to a still-connected social_connection and aren't over quota.

create table if not exists x_scheduled_posts (
    id              uuid        primary key default gen_random_uuid(),
    user_id         uuid        not null references users(id) on delete cascade,
    agent_id        text,
    text            text        not null,
    scheduled_at    timestamptz not null,
    posted_at       timestamptz,
    tweet_id        text,
    error           text,
    attempts        int         not null default 0,
    created_at      timestamptz not null default now()
);

create index if not exists x_scheduled_due_idx
    on x_scheduled_posts(scheduled_at)
    where posted_at is null and error is null;

create index if not exists x_scheduled_user_idx
    on x_scheduled_posts(user_id, scheduled_at desc);
