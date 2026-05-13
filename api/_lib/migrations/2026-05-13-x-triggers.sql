-- Auto-post triggers. Each row is a rule like "tweet daily at 9am UTC" or
-- "tweet when my token mcap crosses these thresholds". The run-x-triggers
-- cron evaluates predicates and enqueues posts in x_scheduled_posts.

create table if not exists x_triggers (
    id              uuid        primary key default gen_random_uuid(),
    user_id         uuid        not null references users(id) on delete cascade,
    agent_id        text,
    kind            text        not null check (kind in (
                        'daily_persona',
                        'weekly_digest',
                        'price_milestone',
                        'payment_received'
                    )),
    config          jsonb       not null default '{}'::jsonb,
    enabled         boolean     not null default true,
    last_fired_at   timestamptz,
    last_state      jsonb       not null default '{}'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists x_triggers_user_idx    on x_triggers(user_id);
create index if not exists x_triggers_enabled_idx on x_triggers(kind, enabled) where enabled = true;
