-- Human tasks: agents hire people for physical-world work with escrowed USDC.
-- Apply: npm run db:status, then npm run db:migrate. Idempotent.
--
-- An agent posts a task (pick up an item, photograph a place, stand in a line)
-- with a USDC bounty. The bounty plus the platform fee leaves the agent wallet
-- on post, through the platform signer and the agent's spend guards, into an
-- escrow account derived per task (api/_lib/human-tasks/chain.js). A person
-- accepts the task on /tasks, does it, and submits proof (photos in object
-- storage, notes). The poster approves and escrow pays the worker's linked
-- Solana wallet; or the poster disputes and an admin decides.
--
-- Money never moves on a database flag. A task is only `open` once its escrow
-- transfer confirmed on chain. Every escrow payout, fee and refund is a leg
-- sent exactly once (the prior record is persisted before broadcast), so a
-- crash mid-payout resumes instead of paying twice.
--
-- Lifecycle:
--   funding -> open -> accepted -> submitted -> approved -> paid
--                 \          \            \-> disputed -> approved -> paid
--                  \          \                         \-> cancelled (refund)
--                   \          \-> open (worker released the claim or missed the deadline)
--                    \-> cancelled (refund)
--                    \-> expired (deadline passed unclaimed: refund)
--   Every cancelled or expired task that was funded carries refund_status
--   pending -> sent, driven by the human-tasks-sweep cron.

begin;

create table if not exists human_tasks (
    id                      uuid primary key default gen_random_uuid(),
    poster_agent_id         uuid not null references agent_identities(id),
    poster_user_id          uuid not null references users(id),
    status                  text not null default 'funding',
    title                   text not null,
    instructions            text not null,
    category                text not null default 'other',
    -- remote: no location. onsite: the task happens at (lat, lng) within radius_m.
    location_kind           text not null default 'remote',
    location_label          text,
    lat                     double precision,
    lng                     double precision,
    radius_m                integer,
    deadline_at             timestamptz not null,
    -- Money, all USDC atomics (6dp). escrow_atomics = bounty + fee.
    bounty_atomics          bigint not null,
    fee_atomics             bigint not null default 0,
    fee_bps                 integer not null default 0,
    escrow_atomics          bigint not null,
    network                 text not null default 'mainnet',
    escrow_address          text not null,
    escrow_signature        text,
    custody_event_id        bigint,
    funded_at               timestamptz,
    funding_error           text,
    -- Minimum worker verification level: 0 account + linked wallet,
    -- 1 verified email, 2 trusted (track record).
    -- See api/_lib/human-tasks/verification.js.
    min_verification        smallint not null default 0,
    proof_requirements      text,
    -- Mirror to an external human-task network when nobody here claims it.
    allow_external          boolean not null default false,
    external_provider       text,
    external_ref            text,
    external_mirrored_at    timestamptz,
    external_error          text,
    -- The quote this task was posted from (human_task_quotes.id).
    quote_id                uuid,
    accepted_claim_id       uuid,
    submitted_at            timestamptz,
    -- The poster must approve or dispute before this, or the escrow releases
    -- to the worker on its own (the worker's protection against silence).
    review_due_at           timestamptz,
    approved_at             timestamptz,
    approved_by             text,
    -- Release preview the approve call must quote back (preview_id).
    release_preview_id      text,
    release_preview_expires_at timestamptz,
    payout_address          text,
    payout_signature        text,
    payout_leg              jsonb,
    fee_signature           text,
    fee_leg                 jsonb,
    fee_recipient           text,
    paid_at                 timestamptz,
    payout_error            text,
    payout_attempts         integer not null default 0,
    refund_status           text,
    refund_address          text,
    refund_signature        text,
    refund_leg              jsonb,
    refund_error            text,
    refund_attempts         integer not null default 0,
    -- Lease: an inline payout/refund and the sweep never send the same leg.
    settle_locked_until     timestamptz,
    cancelled_at            timestamptz,
    cancel_reason           text,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'human_tasks_status_chk') then
        alter table human_tasks add constraint human_tasks_status_chk
            check (status in ('funding', 'open', 'accepted', 'submitted', 'approved', 'disputed',
                              'paid', 'cancelled', 'expired'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'human_tasks_money_chk') then
        alter table human_tasks add constraint human_tasks_money_chk
            check (bounty_atomics > 0 and fee_atomics >= 0 and escrow_atomics = bounty_atomics + fee_atomics);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'human_tasks_location_chk') then
        alter table human_tasks add constraint human_tasks_location_chk
            check (location_kind = 'remote'
                   or (location_kind = 'onsite' and lat between -90 and 90 and lng between -180 and 180));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'human_tasks_refund_chk') then
        alter table human_tasks add constraint human_tasks_refund_chk
            check (refund_status is null or refund_status in ('pending', 'sent', 'failed'));
    end if;
end $$;

create index if not exists human_tasks_browse on human_tasks (status, created_at desc);
create index if not exists human_tasks_poster on human_tasks (poster_agent_id, created_at desc);
create index if not exists human_tasks_owner on human_tasks (poster_user_id, created_at desc);
create index if not exists human_tasks_geo on human_tasks (lat, lng) where status = 'open' and location_kind = 'onsite';
create index if not exists human_tasks_deadline on human_tasks (deadline_at) where status in ('open', 'accepted');
create index if not exists human_tasks_review_due on human_tasks (review_due_at) where status = 'submitted';
create index if not exists human_tasks_refund_due on human_tasks (updated_at) where refund_status = 'pending';
create index if not exists human_tasks_payout_due on human_tasks (updated_at) where status = 'approved';

-- A price the agent owner saw before posting. Ten minutes, single use.
create table if not exists human_task_quotes (
    id              uuid primary key default gen_random_uuid(),
    agent_id        uuid not null references agent_identities(id),
    user_id         uuid not null references users(id),
    -- The exact task the quote priced; post creates exactly this task.
    params          jsonb not null,
    bounty_atomics  bigint not null,
    fee_atomics     bigint not null,
    fee_bps         integer not null,
    escrow_atomics  bigint not null,
    network         text not null default 'mainnet',
    expires_at      timestamptz not null,
    used_at         timestamptz,
    task_id         uuid,
    created_at      timestamptz not null default now()
);

create index if not exists human_task_quotes_agent on human_task_quotes (agent_id, created_at desc);

-- Who accepted a task. At most one live claim per task; a released or lapsed
-- claim frees the task for the next person.
create table if not exists human_task_claims (
    id              uuid primary key default gen_random_uuid(),
    task_id         uuid not null references human_tasks(id),
    worker_kind     text not null default 'user',
    worker_user_id  uuid references users(id),
    external_provider text,
    external_worker_ref text,
    payout_address  text not null,
    status          text not null default 'active',
    verification_level smallint not null default 0,
    note            text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    released_at     timestamptz
);

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'human_task_claims_status_chk') then
        alter table human_task_claims add constraint human_task_claims_status_chk
            check (status in ('active', 'submitted', 'released', 'lapsed', 'completed', 'lost'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'human_task_claims_worker_chk') then
        alter table human_task_claims add constraint human_task_claims_worker_chk
            check ((worker_kind = 'user' and worker_user_id is not null)
                   or (worker_kind = 'external' and external_provider is not null));
    end if;
end $$;

create unique index if not exists human_task_claims_one_live
    on human_task_claims (task_id) where status in ('active', 'submitted', 'completed');
create index if not exists human_task_claims_worker on human_task_claims (worker_user_id, created_at desc);

-- Proof of work: notes plus photo object keys in private object storage.
create table if not exists human_task_submissions (
    id              uuid primary key default gen_random_uuid(),
    task_id         uuid not null references human_tasks(id),
    claim_id        uuid not null references human_task_claims(id),
    notes           text not null default '',
    -- [{ key, content_type, bytes }]; read back through short-lived signed URLs.
    photos          jsonb not null default '[]'::jsonb,
    lat             double precision,
    lng             double precision,
    created_at      timestamptz not null default now()
);

create index if not exists human_task_submissions_task on human_task_submissions (task_id, created_at desc);

-- Photos the worker has uploaded; promoted into a submission on submit.
create table if not exists human_task_uploads (
    id              uuid primary key default gen_random_uuid(),
    task_id         uuid not null references human_tasks(id),
    claim_id        uuid not null references human_task_claims(id),
    object_key      text not null unique,
    content_type    text not null,
    created_at      timestamptz not null default now()
);

create index if not exists human_task_uploads_claim on human_task_uploads (claim_id);

-- Disputes and their owner-gated resolution.
create table if not exists human_task_disputes (
    id              uuid primary key default gen_random_uuid(),
    task_id         uuid not null references human_tasks(id),
    opened_by       text not null,
    opened_by_user_id uuid references users(id),
    reason          text not null,
    worker_response text,
    status          text not null default 'open',
    outcome         text,
    resolution_note text,
    resolved_by     uuid references users(id),
    resolved_at     timestamptz,
    created_at      timestamptz not null default now()
);

create unique index if not exists human_task_disputes_one_open
    on human_task_disputes (task_id) where status = 'open';
create index if not exists human_task_disputes_queue on human_task_disputes (status, created_at);

-- Ratings both ways, once per side per task.
create table if not exists human_task_reviews (
    id              uuid primary key default gen_random_uuid(),
    task_id         uuid not null references human_tasks(id),
    reviewer_role   text not null,
    reviewer_user_id uuid references users(id),
    subject_agent_id uuid references agent_identities(id),
    subject_user_id uuid references users(id),
    rating          smallint not null,
    comment         text,
    created_at      timestamptz not null default now()
);

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'human_task_reviews_rating_chk') then
        alter table human_task_reviews add constraint human_task_reviews_rating_chk
            check (rating between 1 and 5 and reviewer_role in ('poster', 'worker'));
    end if;
end $$;

create unique index if not exists human_task_reviews_once on human_task_reviews (task_id, reviewer_role);
create index if not exists human_task_reviews_agent on human_task_reviews (subject_agent_id) where subject_agent_id is not null;
create index if not exists human_task_reviews_user on human_task_reviews (subject_user_id) where subject_user_id is not null;

-- Audit trail: every state change with who did it.
create table if not exists human_task_events (
    id              bigserial primary key,
    task_id         uuid not null references human_tasks(id),
    actor_kind      text not null,
    actor_user_id   uuid,
    event           text not null,
    from_status     text,
    to_status       text,
    detail          jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now()
);

create index if not exists human_task_events_task on human_task_events (task_id, id);

commit;
