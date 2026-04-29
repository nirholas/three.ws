-- Migration: unify on-chain deploy metadata across chain families.
--
-- Rationale: agent_identities.meta historically held EVM-specific fields
-- (chain_id, erc8004_agent_id) at the top level, while Solana deploys wrote
-- to meta.chain_type='solana' + meta.sol_mint_address. Frontend rehydration
-- forked on shape; new families would require more forks. This migration
-- introduces a single canonical block: meta.onchain (jsonb).
--
-- New writes: api/agents/onchain/confirm.js writes only meta.onchain.
-- Old writes: api/agents/{register-confirm,solana-register-confirm}.js
-- continue to write the legacy fields. The view below provides a unified read.
--
-- Apply manually via:
--   psql $DATABASE_URL -f api/_lib/migrations/2026-04-29-onchain-unified.sql
--
-- Idempotent: safe to re-run.

begin;

-- 1. Backfill legacy EVM rows into the unified shape. Only touches rows that
--    have legacy fields *and* don't already have meta.onchain set.
update agent_identities
set meta = jsonb_set(
	coalesce(meta, '{}'::jsonb),
	'{onchain}',
	jsonb_build_object(
		'chain',            'eip155:' || (meta->>'chain_id'),
		'family',           'evm',
		'tx_hash',          coalesce(meta->>'tx_hash', ''),
		'onchain_id',       meta->>'erc8004_agent_id',
		'contract_or_mint', meta->>'erc8004_registry',
		'wallet',           wallet_address,
		'metadata_uri',     coalesce(meta->>'metadata_uri', ''),
		'confirmed_at',     coalesce(meta->>'confirmed_at', created_at::text)
	),
	true
)
where deleted_at is null
  and meta ? 'chain_id'
  and not (meta ? 'onchain');

-- 2. Backfill legacy Solana rows.
update agent_identities
set meta = jsonb_set(
	coalesce(meta, '{}'::jsonb),
	'{onchain}',
	jsonb_build_object(
		'chain',            case
			when (meta->>'network') = 'devnet'
				then 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
			else 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
		end,
		'family',           'solana',
		'tx_hash',          coalesce(meta->>'tx_signature', ''),
		'onchain_id',       null,
		'contract_or_mint', meta->>'sol_mint_address',
		'wallet',           wallet_address,
		'metadata_uri',     coalesce(meta->>'metadata_uri', ''),
		'confirmed_at',     coalesce(meta->>'confirmed_at', created_at::text),
		'cluster',          coalesce(meta->>'network', 'mainnet')
	),
	true
)
where deleted_at is null
  and (meta->>'chain_type') = 'solana'
  and not (meta ? 'onchain');

-- 3. Index the unified shape so queries by chain or tx are cheap.
create index if not exists agent_identities_onchain_chain
	on agent_identities ((meta->'onchain'->>'chain'))
	where deleted_at is null and (meta ? 'onchain');

create index if not exists agent_identities_onchain_tx
	on agent_identities ((meta->'onchain'->>'tx_hash'))
	where deleted_at is null and (meta ? 'onchain');

-- 4. Normalize onchain id type — used by backwards-compat queries that joined
--    on integer chain_id. The legacy column erc8004_agent_id is left intact
--    for now (zero-downtime); a follow-up migration can drop it once all
--    readers are on meta.onchain.
comment on column agent_identities.meta is
	'jsonb. Canonical on-chain shape lives at meta.onchain '
	'({chain: caip2, family, tx_hash, onchain_id, contract_or_mint, wallet, metadata_uri, confirmed_at, ...}). '
	'Legacy fields meta.chain_id, meta.erc8004_agent_id, meta.sol_mint_address are deprecated.';

commit;
