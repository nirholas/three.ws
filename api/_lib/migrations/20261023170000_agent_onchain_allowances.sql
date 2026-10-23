begin;

-- Owner-funded agent budgets enforced by the Solana Subscriptions and
-- Allowances program. The chain is the source of truth for what is left; this
-- table only remembers which delegation accounts belong to which agent, and the
-- cap at creation (the program stores only the remaining amount), so the UI can
-- show cap / spent / remaining and the guards know which PDA to read.
--
-- Writers: api/agents/solana-allowance.js (confirm, revoke)
-- Readers: api/agents/solana-allowance.js, api/agent/guard.js

create table if not exists agent_onchain_allowances (
	id               uuid primary key default gen_random_uuid(),
	agent_id         uuid not null references agent_identities(id) on delete cascade,
	user_id          uuid not null references users(id) on delete cascade,
	network          text not null check (network in ('mainnet', 'devnet')),
	kind             text not null default 'fixed' check (kind in ('fixed', 'recurring')),
	owner_wallet     text not null,
	delegatee        text not null,
	mint             text not null,
	nonce            numeric(40, 0) not null,
	delegation_pda   text not null,
	cap_raw          numeric(40, 0) not null check (cap_raw > 0),
	expiry_ts        bigint not null default 0,
	period_length_s  bigint,
	create_signature text,
	revoke_signature text,
	revoked_at       timestamptz,
	created_at       timestamptz not null default now(),
	unique (network, delegation_pda)
);

create index if not exists agent_onchain_allowances_agent
	on agent_onchain_allowances (agent_id, network)
	where revoked_at is null;

commit;
