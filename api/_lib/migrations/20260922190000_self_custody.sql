-- Self-custody: signer modes, external transactions, fresh re-authentication,
-- and hourly balance history (api/_lib/custody/, docs/agent-wallets.md).
--
--   agent_signers           how an agent's fund-moving actions are signed.
--                           'platform' (the default, no row needed) signs with
--                           the custodial key. 'external' never touches a
--                           platform key: every fund-moving route returns an
--                           unsigned transaction for the owner's wallet.
--                           'session' lets the agent act unattended through a
--                           delegate key the owner granted from their own
--                           wallet with an on-chain SPL approval, so the cap is
--                           enforced by the token program as well as by us.
--   pending_external_txs    every unsigned transaction handed to an external
--                           signer, with the exact message bytes it must sign.
--                           POST /api/tx/submit verifies the signature against
--                           this row, broadcasts, and reconciles it into
--                           agent_custody_events.
--   auth_reauth             single-use step-up grants for the few actions that
--                           need proof the account holder is present right now
--                           (key export). Challenges and grants share the table.
--   agent_balance_history   hourly SOL + USDC snapshot per agent wallet, written
--                           by /api/cron/balance-snapshot.

begin;

create table if not exists agent_signers (
    agent_id                 uuid         primary key,
    user_id                  uuid         not null,
    mode                     text         not null default 'platform'
                                          check (mode in ('platform', 'external', 'session')),
    external_pubkey          text,
    session_pubkey           text,
    session_secret_enc       text,
    session_network          text         check (session_network in ('mainnet', 'devnet')),
    session_mint             text,
    session_decimals         integer,
    session_cap_raw          numeric,
    session_cap_usd          numeric,
    session_spent_raw        numeric      not null default 0,
    session_expires_at       timestamptz,
    session_status           text         check (session_status in ('pending', 'active', 'revoked', 'expired')),
    session_grant_signature  text,
    session_fee_lamports     bigint,
    created_at               timestamptz  not null default now(),
    updated_at               timestamptz  not null default now()
);

create index if not exists agent_signers_user on agent_signers (user_id);

create table if not exists pending_external_txs (
    id                      uuid         primary key default gen_random_uuid(),
    user_id                 uuid         not null,
    agent_id                uuid,
    kind                    text         not null,
    network                 text         not null default 'mainnet',
    signer_pubkey           text         not null,
    message_b64             text         not null,
    tx_b64                  text         not null,
    tx_version              text         not null,
    summary                 jsonb        not null default '{}'::jsonb,
    simulation              jsonb,
    status                  text         not null default 'prepared'
                                         check (status in ('prepared', 'submitted', 'confirmed', 'failed', 'expired')),
    signature               text,
    message_modified        boolean      not null default false,
    custody_event_id        bigint,
    error                   text,
    last_valid_block_height bigint,
    expires_at              timestamptz  not null,
    submitted_at            timestamptz,
    confirmed_at            timestamptz,
    created_at              timestamptz  not null default now(),
    updated_at              timestamptz  not null default now()
);

create index if not exists pending_external_txs_user on pending_external_txs (user_id, created_at desc);
create index if not exists pending_external_txs_agent on pending_external_txs (agent_id, created_at desc)
    where agent_id is not null;
create unique index if not exists pending_external_txs_signature on pending_external_txs (signature)
    where signature is not null;

create table if not exists auth_reauth (
    id           uuid         primary key default gen_random_uuid(),
    user_id      uuid         not null,
    kind         text         not null check (kind in ('challenge', 'grant')),
    method       text         not null check (method in ('password', 'wallet', 'email_code')),
    purpose      text         not null,
    nonce        text,
    code_hash    text,
    token_hash   text,
    attempts     integer      not null default 0,
    expires_at   timestamptz  not null,
    used_at      timestamptz,
    created_at   timestamptz  not null default now()
);

create index if not exists auth_reauth_user on auth_reauth (user_id, created_at desc);
create unique index if not exists auth_reauth_token on auth_reauth (token_hash) where token_hash is not null;

create table if not exists agent_balance_history (
    agent_id     uuid         not null,
    network      text         not null default 'mainnet',
    captured_at  timestamptz  not null,
    address      text         not null,
    lamports     bigint,
    usdc_raw     numeric,
    sol_usd      numeric,
    usd_total    numeric,
    primary key (agent_id, network, captured_at)
);

create index if not exists agent_balance_history_captured on agent_balance_history (captured_at);

commit;
