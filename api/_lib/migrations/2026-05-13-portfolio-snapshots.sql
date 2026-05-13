-- Portfolio value snapshots. The dashboard's portfolio page writes one row each
-- time the user hits "Refresh". Chart reads the trailing N days for that user.
--
-- Writes are user-driven (not a cron), so the table grows O(refreshes) — not
-- O(users × time). Index supports the per-user trailing-window read.

create table if not exists portfolio_snapshots (
    id          uuid        primary key default gen_random_uuid(),
    user_id     uuid        not null references users(id) on delete cascade,
    captured_at timestamptz not null default now(),
    total_usd   numeric(20, 4) not null,
    breakdown   jsonb       not null default '[]'::jsonb
);

create index if not exists portfolio_snapshots_user_time
    on portfolio_snapshots(user_id, captured_at desc);
