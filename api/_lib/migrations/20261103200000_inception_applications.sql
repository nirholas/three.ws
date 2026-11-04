-- Partner startup-program perks: applications for free prepaid generation credits,
-- plus an optional public shoutout that earns a bonus.
--
-- First program: NVIDIA Inception. `program` keys a member program defined in
-- api/_lib/inception.js (PROGRAMS), so adding another partner's startup program
-- needs no schema change. No public API proves membership in any of these
-- programs, so every application and every shoutout is reviewed by a person
-- (scripts/inception-review.mjs). Approval grants prepaid credits through the
-- existing credit ledger (kind = 'grant', idempotent on a per-row key).
--
-- One open application per account per program: a pending or approved row blocks a
-- second one, a rejected row does not (the applicant can fix the details and
-- reapply). A shoutout URL can back only one bonus, ever.

create table if not exists inception_applications (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references users(id) on delete cascade,
    program           text not null default 'nvidia-inception',
    company           text not null,
    website           text not null,
    contact_email     text not null,
    inception_ref     text,
    use_case          text not null,
    status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected')),
    grant_usd         numeric(20, 6),
    reviewer_note     text,
    reviewed_at       timestamptz,
    shoutout_url      text,
    shoutout_status   text not null default 'none'
                      check (shoutout_status in ('none', 'submitted', 'approved', 'rejected')),
    shoutout_bonus_usd numeric(20, 6),
    shoutout_note     text,
    shoutout_at       timestamptz,
    created_at        timestamptz not null default now()
);

create unique index if not exists inception_applications_one_open_per_program
    on inception_applications (user_id, program)
    where status in ('pending', 'approved');

create unique index if not exists inception_applications_shoutout_url_once
    on inception_applications (shoutout_url)
    where shoutout_url is not null and shoutout_status in ('submitted', 'approved');

create index if not exists inception_applications_status_created
    on inception_applications (status, created_at);

create index if not exists inception_applications_shoutout_queue
    on inception_applications (shoutout_status, shoutout_at)
    where shoutout_status = 'submitted';
