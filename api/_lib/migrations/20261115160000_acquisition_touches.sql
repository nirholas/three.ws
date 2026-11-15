-- Migration: first-touch attribution for signups that arrive from X.
-- Apply: npm run db:migrate
-- Idempotent.
--
-- One row per account that signed up after landing from an X link (Referer
-- t.co, x.com or twitter.com). Written by api/_lib/acquisition.js when the
-- visitor's first signed-in page load carries the touch cookie; read by
-- `npm run x:content -- plan` per landing page. Holds no personal data beyond
-- the account id, which cascades away with the account.

begin;

create table if not exists acquisition_touches (
    user_id      uuid        primary key references users(id) on delete cascade,
    source       text        not null,
    landing_path text        not null,
    touched_at   timestamptz not null,
    recorded_at  timestamptz not null default now()
);

create index if not exists acquisition_touches_source_time on acquisition_touches (source, touched_at desc);

commit;
