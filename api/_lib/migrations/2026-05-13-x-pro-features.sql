-- Pro features: tone presets, auto-publish flag for triggers, metrics on
-- past posts, cadence guard (last_posted_at), and threads.

alter table avatars             add column if not exists tone                text;
alter table x_triggers          add column if not exists auto_publish        boolean not null default true;
alter table x_posts             add column if not exists metrics             jsonb;
alter table x_posts             add column if not exists metrics_fetched_at  timestamptz;
alter table x_posts             add column if not exists reply_to_tweet_id   text;
alter table x_scheduled_posts   add column if not exists reply_to_tweet_id   text;
alter table x_scheduled_posts   add column if not exists thread_parts        jsonb;
alter table social_connections  add column if not exists last_posted_at      timestamptz;

-- Pending reviews: when a trigger fires with auto_publish=false, we stash
-- the draft here for the user to approve / edit / reject.
create table if not exists x_pending_reviews (
    id              uuid        primary key default gen_random_uuid(),
    user_id         uuid        not null references users(id) on delete cascade,
    trigger_id      uuid        references x_triggers(id) on delete cascade,
    agent_id        text,
    text            text        not null,
    thread_parts    jsonb,
    status          text        not null default 'pending' check (status in ('pending','approved','rejected')),
    created_at      timestamptz not null default now(),
    resolved_at     timestamptz
);

create index if not exists x_pending_reviews_user_pending_idx
    on x_pending_reviews(user_id, created_at desc) where status = 'pending';
