-- Pre-tx idempotency claim table for the pumpkit -> attestation bridge
-- (api/agents/solana-attest-event.js).
--
-- Design: the handler INSERTs a claim row before sending the Solana
-- transaction. The primary key serializes concurrent webhook deliveries
-- at the DB layer, so only one delivery pays the on-chain fee. Other
-- deliveries hit unique_violation (Postgres 23505), short-circuit, and
-- return the winning signature once the leader records it.

create table if not exists solana_attest_event_claims (
	agent_asset  text        not null,
	network      text        not null,
	event_id     text        not null,
	attester     text        not null,
	claimed_at   timestamptz not null default now(),
	completed_at timestamptz,
	signature    text,
	primary key (agent_asset, network, event_id)
);

create index if not exists solana_attest_event_claims_pending_idx
	on solana_attest_event_claims (claimed_at)
	where signature is null;
