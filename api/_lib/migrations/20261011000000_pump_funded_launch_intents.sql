-- Migration: funded launch intents. A coin launch that an agent or a CLI
-- creates as an intent, that the owner funds and confirms from a same-site
-- session or the approval inbox, and that signs from the agent's custodial
-- wallet only after an explicit yes.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261011000000_pump_funded_launch_intents.sql
-- Idempotent.
--
-- pump_funded_launch_intents
--   stage              quote -> paid -> submitted -> confirmed -> indexed, with
--                      failed and expired as the two terminal side exits. The
--                      quote -> paid step is a single conditional UPDATE keyed
--                      on the funding proof, so a replayed proof returns the
--                      stored result and never re-credits.
--   quote              every fee line the creator was shown, with its expiry,
--                      canonical JSON. The payload the approval executes is
--                      derived from this row, never from a later request body.
--   preflight_token_hash  sha256 of the one-time token the quote handed out.
--                      The funding proof must carry the raw token, so a
--                      signature found on chain cannot be attached to someone
--                      else's intent.
--   payment_signature  the funding transaction, unique across intents: one
--                      transfer funds exactly one launch.
--   mint_secret        the new coin's keypair, encrypted with the wallet master
--                      key while the intent is open and cleared once the launch
--                      has landed or the intent is closed.
--   approval_id        the approval_requests row the final confirmation filed.
--                      Text, not a foreign key, so this table stands on its own.

create table if not exists pump_funded_launch_intents (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references users(id) on delete cascade,
	agent_id uuid not null references agent_identities(id) on delete cascade,
	network text not null check (network in ('mainnet', 'devnet')),
	stage text not null default 'quote'
		check (stage in ('quote', 'paid', 'submitted', 'confirmed', 'indexed', 'failed', 'expired')),
	name text not null,
	symbol text not null,
	description text not null default '',
	image_url text,
	metadata_uri text,
	quote_asset text not null,
	quote_mint text,
	quote_symbol text not null,
	quote_decimals integer not null default 9,
	initial_buy_atomics numeric(30, 0) not null default 0,
	creator_fee_bps integer not null default 0 check (creator_fee_bps between 0 and 10000),
	quote jsonb not null,
	quote_expires_at timestamptz not null,
	preflight_token_hash text not null unique,
	funding_address text not null,
	payment_signature text unique,
	payment_result jsonb,
	paid_at timestamptz,
	approval_id text,
	mint text unique,
	mint_secret text,
	launch_signature text,
	submitted_at timestamptz,
	confirmed_at timestamptz,
	indexed_at timestamptz,
	indexed_by text,
	dry_run jsonb,
	error text,
	result jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists pump_funded_launch_intents_user_idx
	on pump_funded_launch_intents (user_id, created_at desc);
create index if not exists pump_funded_launch_intents_agent_idx
	on pump_funded_launch_intents (agent_id, created_at desc);
create index if not exists pump_funded_launch_intents_open_idx
	on pump_funded_launch_intents (stage, quote_expires_at)
	where stage in ('quote', 'paid', 'submitted', 'confirmed');
