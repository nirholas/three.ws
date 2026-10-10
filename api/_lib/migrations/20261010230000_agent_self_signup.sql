-- Migration: agent self-signup. An autonomous agent proves it holds an Ed25519
-- key by signing a payload; the platform creates the agent, its custodial
-- wallets and a paper-mode account. A human later claims it with a one-time
-- code. Idempotent.
--
-- agent_self_signups
--   public_key        base58 Ed25519 key that signed the signup. One signup per key.
--   agent_id / user_id the created agent and its placeholder owner row.
--   api_key_id        the key returned once at signup; retired when a human claims.
--   claim_code_hash   sha256 of the one-time claim code (never the code itself).
--   claimed_at        set when a human takes ownership; null while in paper mode.
--
-- agent_self_signup_nonces
--   One row per accepted (public_key, nonce). The primary key is the replay
--   guard: a second insert of the same pair fails, on every instance, which an
--   in-memory or per-instance cache cannot promise. Rows are pruned past the
--   timestamp window.

create table if not exists agent_self_signups (
    id               uuid primary key default gen_random_uuid(),
    public_key       text not null unique,
    agent_id         uuid not null references agent_identities(id) on delete cascade,
    user_id          uuid not null references users(id) on delete cascade,
    api_key_id       uuid,
    requested_name   text not null,
    signup_ip        text,
    claim_code_hash  text not null,
    claim_expires_at timestamptz not null,
    claimed_at       timestamptz,
    claimed_by       uuid references users(id) on delete set null,
    created_at       timestamptz not null default now()
);

create unique index if not exists agent_self_signups_agent_uniq on agent_self_signups(agent_id);
create unique index if not exists agent_self_signups_claim_uniq on agent_self_signups(claim_code_hash);

create table if not exists agent_self_signup_nonces (
    public_key text not null,
    nonce      text not null,
    seen_at    timestamptz not null default now(),
    primary key (public_key, nonce)
);

create index if not exists agent_self_signup_nonces_seen on agent_self_signup_nonces(seen_at);
