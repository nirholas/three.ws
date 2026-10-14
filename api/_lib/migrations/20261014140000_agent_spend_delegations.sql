-- Owner-signed, epoch-bounded spend delegations (work order 515-integrate-16).
-- A delegation is an Ed25519 signature, over a fixed-field plain-text message
-- (see packages/agent-guards/src/delegation.js), by the agent's OWNER wallet,
-- authorizing at most `cap_lamports_per_epoch` of realized spend per rolling
-- `epoch_seconds` window, until `not_after`. Anyone (not just three.ws) can
-- verify the signature offline; the platform additionally enforces the cap
-- server-side against the agent's real, realized spend ledger
-- (agent_custody_events), never the caller's self-reported notional.
--
-- `nonce` is unique per agent FOREVER (not just while "active"): once a
-- delegation has been registered, replaying the exact same signed envelope
-- (same nonce) is rejected, even after it expires or is superseded. That is
-- what stops a captured-off-the-wire delegation from being re-submitted to
-- reset bookkeeping or re-arm a lapsed authorization.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261014140000_agent_spend_delegations.sql
-- Idempotent.

begin;

create table if not exists agent_spend_delegations (
	id                      uuid primary key default gen_random_uuid(),
	agent_id                uuid not null references agent_identities(id) on delete cascade,
	owner_wallet            text not null,
	cap_lamports_per_epoch  bigint not null,
	epoch_seconds           integer not null,
	not_after               timestamptz not null,
	nonce                   text not null,
	signature               text not null,
	status                  text not null default 'active',
	created_at              timestamptz not null default now(),
	revoked_at              timestamptz,

	constraint agent_spend_delegations_nonce_unique unique (agent_id, nonce),
	constraint agent_spend_delegations_cap_check check (cap_lamports_per_epoch > 0),
	constraint agent_spend_delegations_epoch_check check (epoch_seconds > 0),
	constraint agent_spend_delegations_owner_wallet_check check (char_length(owner_wallet) between 32 and 44),
	constraint agent_spend_delegations_status_check check (status in ('active', 'revoked', 'expired'))
);

-- The active delegation for an agent is "the most recent row with status =
-- 'active' and not_after in the future", read with ORDER BY created_at DESC
-- LIMIT 1. This partial index keeps that lookup cheap without needing a
-- separate "is_current" flag to keep in sync.
create index if not exists idx_spend_delegations_agent_active
	on agent_spend_delegations(agent_id, created_at desc)
	where status = 'active';

commit;
