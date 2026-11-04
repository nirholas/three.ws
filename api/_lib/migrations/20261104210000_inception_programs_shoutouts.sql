-- Partner startup-program perks: a program key per application, plus an optional
-- public shoutout that earns a bonus.
--
-- 20261103200000_inception_applications.sql created the table for NVIDIA
-- Inception only and is already applied, so the generalisation lands here as a
-- roll-forward. `program` keys a member program defined in api/_lib/inception.js
-- (PROGRAMS); existing rows are NVIDIA Inception applications, which the default
-- records. No public API proves membership in any of these programs, so every
-- application and every shoutout is reviewed by a person
-- (scripts/inception-review.mjs), and approval grants prepaid credits through the
-- credit ledger (kind = 'grant', idempotent on a per-row key).
--
-- One open application per account per program: a pending or approved row blocks a
-- second one for the same program, a rejected row does not. A shoutout URL can
-- back only one bonus, ever.

begin;

alter table inception_applications
    add column if not exists program            text not null default 'nvidia-inception',
    add column if not exists shoutout_url       text,
    add column if not exists shoutout_status    text not null default 'none'
        check (shoutout_status in ('none', 'submitted', 'approved', 'rejected')),
    add column if not exists shoutout_bonus_usd numeric(20, 6),
    add column if not exists shoutout_note      text,
    add column if not exists shoutout_at        timestamptz;

create unique index if not exists inception_applications_one_open_per_program
    on inception_applications (user_id, program)
    where status in ('pending', 'approved');

drop index if exists inception_applications_one_open_per_user;

create unique index if not exists inception_applications_shoutout_url_once
    on inception_applications (shoutout_url)
    where shoutout_url is not null and shoutout_status in ('submitted', 'approved');

create index if not exists inception_applications_shoutout_queue
    on inception_applications (shoutout_status, shoutout_at)
    where shoutout_status = 'submitted';

commit;
