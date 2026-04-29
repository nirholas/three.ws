-- Migration: pumpkit -> attestation bridge state.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-29-attest-event-bridge.sql
-- Idempotent.
--
-- Tables/indexes for the production webhook in api/agents/solana-attest-event.js.
-- Combines the two earlier scripts/migrations files into a single canonical
-- migration alongside the rest of the dated migration set.

begin;

-- ── solana_attest_event_claims ─────────────────────────────────────────────
-- Pre-tx idempotency claim. The handler INSERTs a claim row before sending
-- the Solana transaction; the primary key serializes concurrent retries so
-- only one delivery pays the on-chain fee. Stale claims (signature still null
-- after the tx send timed out or crashed) are reaped by the cleanup cron at
-- /api/cron/solana-attest-event-cleanup.

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

-- ── solana_attestations payload event_id index ─────────────────────────────
-- 1. Performance: the dedupe lookup uses payload->>'event_id'. Without an
--    expression index this is O(n) over the table.
-- 2. Correctness: the unique partial index closes the race window between the
--    app-layer SELECT and the INSERT in the webhook handler. On Postgres 23505
--    the handler catches and returns the winning signature.
-- Partial because legacy memo feedback rows do not carry an event_id.

create unique index if not exists
	solana_attestations_event_id_uniq
	on solana_attestations (agent_asset, network, (payload->>'event_id'))
	where payload ? 'event_id';

commit;
