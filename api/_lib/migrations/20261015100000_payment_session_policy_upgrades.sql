-- Spend policy upgrades for Agent Payment Sessions.
--
-- Three new policy knobs on payment_sessions, enforced atomically by
-- api/_lib/pay/spend-governor.js and predicted in parity by api/pay/simulate.js
-- (both share api/_lib/pay/policy.js):
--
--   approval_threshold_usdc: a payment above this amount gets a distinct
--                             requires_approval verdict instead of settling.
--   blocked_hosts: a denylist checked after the allowlist so an explicit
--                  block always wins over a broad allow.
--   per_rail_daily_usdc: a rolling 24h spend cap, keyed by the CAIP-2
--                        network id the x402 challenge actually quoted
--                        (payment_session_executions.network already
--                        stores this), so the cap survives a session
--                        later settling on more than one rail.
--
-- payment_session_rail_reservations backs the rolling-window cap with the
-- same eager reserve-then-roll-back-on-failure pattern spent_usdc already
-- uses, instead of summing payment_session_executions: an execution row is
-- only written after the downstream x402 call finishes, so two concurrent
-- calls on the same rail would both read "nothing in flight yet" and both
-- pass. A reservation row lands atomically (one advisory-locked statement)
-- before the call starts, closing that window.
--
-- payment_session_executions gains the signed-verdict columns: every
-- verdict (allow or reject) carries a sha256 digest of the policy it was
-- judged against and an HMAC over {verdict, digest, request hash,
-- timestamp}, so a verdict stored next to an execution is tamper-evident:
-- editing the policy afterward changes the digest and breaks the signature.

alter table payment_sessions
    add column if not exists approval_threshold_usdc bigint check (approval_threshold_usdc > 0),
    add column if not exists blocked_hosts text[] not null default '{}',
    add column if not exists per_rail_daily_usdc jsonb not null default '{}'::jsonb;

alter table payment_session_executions
    add column if not exists policy_digest text,
    add column if not exists verdict_code text,
    add column if not exists verdict_signature text,
    add column if not exists verdict_signed_at timestamptz;

create table if not exists payment_session_rail_reservations (
    id          uuid primary key default gen_random_uuid(),
    session_id  uuid not null references payment_sessions(id) on delete cascade,
    network     text not null, -- CAIP-2 id, e.g. 'solana:5eykt...' or 'eip155:8453'
    amount_usdc bigint not null check (amount_usdc > 0),
    created_at  timestamptz not null default now()
);

create index if not exists psrr_session_network_window
    on payment_session_rail_reservations (session_id, network, created_at desc);
