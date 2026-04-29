-- Indexes the event_id stored in solana_attestations.payload for the
-- pumpkit -> attestation bridge (api/agents/solana-attest-event.js).
--
-- Two effects:
--   1. Performance: the idempotency lookup
--        select 1 from solana_attestations
--        where agent_asset = $1 and network = $2 and payload->>'event_id' = $3
--      becomes O(log n) instead of a sequential scan.
--   2. Correctness: the unique partial index serializes concurrent webhook
--      retries at the DB layer. If two webhook deliveries race past the
--      app-level dedupe check, the second insert hits unique_violation
--      (Postgres 23505) and the handler returns deduped:true.
--
-- Partial because legacy attestations (user-submitted feedback memos) do
-- not carry an event_id, and we don't want to constrain those.

create unique index concurrently if not exists
	solana_attestations_event_id_uniq
	on solana_attestations (agent_asset, network, (payload->>'event_id'))
	where payload ? 'event_id';
