-- Migration: agent token launches (Pump.fun + future providers).
--
-- Adds:
--   • token_launches_pending — transient prep records (mirrors
--     agent_registrations_pending, but for token launches).
--   • Documents the canonical agent_identities.meta.token shape.
--   • Indexes meta.token.mint for fast lookups by mint pubkey.
--
-- Idempotent: safe to re-run.

begin;

create table if not exists token_launches_pending (
	id            text primary key,                       -- prep_id (random token)
	user_id       uuid not null references users(id) on delete cascade,
	agent_id      uuid not null references agent_identities(id) on delete cascade,
	provider      text not null check (provider in ('pumpfun')),
	cluster       text not null check (cluster in ('mainnet', 'devnet')),
	mint          text not null,                          -- base58 mint pubkey
	metadata_uri  text not null,
	cid           text not null,
	payload       jsonb not null,
	created_at    timestamptz not null default now(),
	expires_at    timestamptz not null
);

create index if not exists token_launches_pending_user_expiry
	on token_launches_pending(user_id, expires_at);

create index if not exists token_launches_pending_agent
	on token_launches_pending(agent_id);

-- Garbage-collection helper. Optional — Vercel/Neon don't auto-vacuum these,
-- so a daily cleanup job (or the prep endpoint itself, lazily) should run:
--   delete from token_launches_pending where expires_at < now() - interval '7 days';

-- Index meta.token.mint so we can answer "which agent owns this mint?" cheaply.
create index if not exists agent_identities_token_mint
	on agent_identities ((meta->'token'->>'mint'))
	where deleted_at is null and (meta ? 'token');

create index if not exists agent_identities_token_provider
	on agent_identities ((meta->'token'->>'provider'))
	where deleted_at is null and (meta ? 'token');

-- Document the canonical shape (no schema change — just a comment for humans).
comment on column agent_identities.meta is
	'jsonb. Canonical blocks: '
	'meta.onchain  (deploy: chain, family, tx_hash, contract_or_mint, wallet, metadata_uri, confirmed_at) | '
	'meta.token    (launch: provider, mint, symbol, name, metadata_uri, cluster, creator, tx_signature, launched_at) | '
	'meta.payments (configure: receiver, accepted_tokens) — reserved for future use';

commit;
