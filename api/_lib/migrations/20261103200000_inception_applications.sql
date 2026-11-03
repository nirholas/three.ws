-- NVIDIA Inception member perk: applications for free prepaid generation credits.
--
-- A signed-in user who is an NVIDIA Inception member applies on /nvidia. There is
-- no public API that proves Inception membership, so every application is reviewed
-- by a person (scripts/inception-review.mjs). Approval grants prepaid credits via
-- the existing credit ledger (kind = 'grant', idempotent on inception:<id>), so the
-- free lane and every paid lane draw from one wallet.
--
-- One open application per account: a pending or approved row blocks a second
-- one, a rejected row does not (the applicant can fix the details and reapply).

create table if not exists inception_applications (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references users(id) on delete cascade,
    company           text not null,
    website           text not null,
    contact_email     text not null,
    -- Optional pointer a reviewer can check: Inception portal profile URL or member ID.
    inception_ref     text,
    use_case          text not null,
    status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected')),
    grant_usd         numeric(20, 6),
    reviewer_note     text,
    reviewed_at       timestamptz,
    created_at        timestamptz not null default now()
);

create unique index if not exists inception_applications_one_open_per_user
    on inception_applications (user_id)
    where status in ('pending', 'approved');

create index if not exists inception_applications_status_created
    on inception_applications (status, created_at);
