-- Migration: agent payments via Pump.fun's agent-payments-sdk.
--
-- Adds:
--   • payment_configs_pending — transient prep records for the one-time
--     create-agent-payments tx (owner registers the agent for payments).
--   • agent_payment_intents — every pay-prep creates one of these rows;
--     pay-confirm flips status to 'paid' and stamps tx_signature + paid_at.
--   • Index on meta.payments.mint and meta.payments.receiver for lookups.
--
-- Idempotent.

begin;

create table if not exists payment_configs_pending (
	id          text primary key,
	user_id     uuid not null references users(id) on delete cascade,
	agent_id    uuid not null references agent_identities(id) on delete cascade,
	cluster     text not null check (cluster in ('mainnet', 'devnet')),
	mint        text not null,
	payload     jsonb not null,
	created_at  timestamptz not null default now(),
	expires_at  timestamptz not null
);

create index if not exists payment_configs_pending_user_expiry
	on payment_configs_pending(user_id, expires_at);

create table if not exists agent_payment_intents (
	id              text primary key,
	payer_user_id   uuid not null references users(id) on delete cascade,
	agent_id        uuid not null references agent_identities(id) on delete cascade,
	currency_mint   text not null,
	amount          text not null,                          -- raw token units; bigint as text
	memo            text not null,
	start_time      timestamptz not null,
	end_time        timestamptz not null,
	status          text not null default 'pending'
		check (status in ('pending', 'paid', 'expired', 'failed')),
	cluster         text not null check (cluster in ('mainnet', 'devnet')),
	tx_signature    text,
	paid_at         timestamptz,
	payload         jsonb not null,
	created_at      timestamptz not null default now(),
	expires_at      timestamptz not null
);

create index if not exists agent_payment_intents_payer
	on agent_payment_intents(payer_user_id, created_at desc);
create index if not exists agent_payment_intents_agent
	on agent_payment_intents(agent_id, status);
create index if not exists agent_payment_intents_status_expiry
	on agent_payment_intents(status, expires_at);

create index if not exists agent_identities_payments_mint
	on agent_identities ((meta->'payments'->>'mint'))
	where deleted_at is null and (meta->'payments'->>'configured') = 'true';

create index if not exists agent_identities_payments_receiver
	on agent_identities ((meta->'payments'->>'receiver'))
	where deleted_at is null and (meta->'payments'->>'configured') = 'true';

commit;
