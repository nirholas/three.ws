-- Creator-fee payouts: where an agent's creator share is sent, what has been
-- sent, and why anything is held.
--
-- creator_payout_wallets
--   One row per agent. `wallet` is the active payout destination, registered by
--   signing a message with that wallet (Ed25519, timestamp and nonce). A change
--   is staged in pending_wallet and only takes effect at pending_effective_at,
--   the cooldown that gives a real owner time to cancel a hijacked change.
--
-- creator_payout_nonces
--   Every signed registration message's nonce, spent once. The primary key is
--   the replay guard: a captured signature can never register twice.
--
-- creator_payout_distributions
--   One row per recorded creator-fee claim (launcher_claims), holding the
--   creator's share in lamports and its life: pending, held (with a reason),
--   sending, sent (with the transfer signature). claim_id is unique, so the
--   distribution cron can re-run any number of times without double-recording.
--
-- creator_payout_state
--   The last held reason an owner was told about, so a held share notifies once
--   per reason change instead of every run.
--
-- creator_payout_reconcile_runs
--   One row per scheduled reconcile of the on-chain vault and the sent
--   transfers against these records.
--
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261023190000_creator_payouts.sql

begin;

create table if not exists creator_payout_wallets (
    agent_id              uuid primary key references agent_identities(id) on delete cascade,
    user_id               uuid not null,
    wallet                text,
    registered_at         timestamptz,
    pending_wallet        text,
    pending_effective_at  timestamptz,
    pending_requested_at  timestamptz,
    changes               integer not null default 0,
    updated_at            timestamptz not null default now(),
    constraint creator_payout_wallet_present check (wallet is not null or pending_wallet is not null)
);

create index if not exists creator_payout_wallets_user_idx on creator_payout_wallets (user_id);
create index if not exists creator_payout_wallets_pending_idx on creator_payout_wallets (pending_effective_at) where pending_wallet is not null;

create table if not exists creator_payout_nonces (
    nonce      text primary key,
    agent_id   uuid not null,
    wallet     text not null,
    issued_at  timestamptz not null,
    used_at    timestamptz not null default now()
);

create index if not exists creator_payout_nonces_used_idx on creator_payout_nonces (used_at);

create table if not exists creator_payout_distributions (
    id               uuid primary key default gen_random_uuid(),
    claim_id         uuid not null unique,
    agent_id         uuid not null,
    user_id          uuid,
    mint             text not null,
    network          text not null default 'mainnet',
    claim_sig        text,
    creator_lamports bigint not null check (creator_lamports >= 0),
    status           text not null default 'pending' check (status in ('pending', 'held', 'sending', 'sent')),
    hold_reason      text,
    payout_wallet    text,
    batch_id         uuid,
    tx_signature     text,
    sent_at          timestamptz,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create index if not exists creator_payout_dist_agent_idx on creator_payout_distributions (agent_id, created_at desc);
create index if not exists creator_payout_dist_open_idx on creator_payout_distributions (agent_id) where status <> 'sent';
create index if not exists creator_payout_dist_sig_idx on creator_payout_distributions (tx_signature) where tx_signature is not null;

create table if not exists creator_payout_state (
    agent_id         uuid primary key,
    last_held_reason text,
    notified_at      timestamptz
);

create table if not exists creator_payout_reconcile_runs (
    id          uuid primary key default gen_random_uuid(),
    ran_at      timestamptz not null default now(),
    ok          boolean not null,
    checked     jsonb not null default '{}'::jsonb,
    drift       jsonb not null default '[]'::jsonb
);

create index if not exists creator_payout_reconcile_runs_idx on creator_payout_reconcile_runs (ran_at desc);

commit;
