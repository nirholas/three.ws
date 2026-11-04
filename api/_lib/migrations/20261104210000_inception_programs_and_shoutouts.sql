-- Partner startup-program perks: key each application to a program and add the
-- optional public shoutout that earns a bonus.
--
-- Rolls forward from 20261103200000_inception_applications.sql, which production
-- applied on 2026-11-04 in its original single-program shape. That file is an
-- immutable record of what ran (apply-migrations.mjs refuses to proceed when an
-- applied file's hash changes), so the program and shoutout schema lands here.
--
-- `program` keys a member program defined in api/_lib/inception.js (PROGRAMS), so
-- adding another partner's startup program needs no schema change. Existing rows
-- are NVIDIA Inception applications, which is the column default.
--
-- One open application per account per program: a pending or approved row blocks a
-- second one in that program, a rejected row does not. A shoutout URL can back only
-- one bonus, ever.

alter table inception_applications
    add column if not exists program text not null default 'nvidia-inception';

alter table inception_applications
    add column if not exists shoutout_url text;

alter table inception_applications
    add column if not exists shoutout_status text not null default 'none'
        check (shoutout_status in ('none', 'submitted', 'approved', 'rejected'));

alter table inception_applications
    add column if not exists shoutout_bonus_usd numeric(20, 6);

alter table inception_applications
    add column if not exists shoutout_note text;

alter table inception_applications
    add column if not exists shoutout_at timestamptz;

drop index if exists inception_applications_one_open_per_user;

create unique index if not exists inception_applications_one_open_per_program
    on inception_applications (user_id, program)
    where status in ('pending', 'approved');

create unique index if not exists inception_applications_shoutout_url_once
    on inception_applications (shoutout_url)
    where shoutout_url is not null and shoutout_status in ('submitted', 'approved');

create index if not exists inception_applications_shoutout_queue
    on inception_applications (shoutout_status, shoutout_at)
    where shoutout_status = 'submitted';
