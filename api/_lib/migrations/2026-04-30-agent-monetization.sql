-- Migration: agent monetization tables.
--
-- Adds:
--   • agent_skill_prices     — per-skill pricing set by agent owner
--   • agent_revenue_events   — immutable earnings record per consumed payment
--   • agent_payout_wallets   — owner wallet addresses for receiving revenue
--   • agent_withdrawals      — payout requests from agent owners

begin;

create table if not exists agent_skill_prices (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references agent_identities(id) on delete cascade,
  skill         text not null,
  currency_mint text not null,
  chain         text not null default 'solana',
  amount        bigint not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (agent_id, skill)
);

create index if not exists agent_skill_prices_agent_id
  on agent_skill_prices (agent_id);

create table if not exists agent_revenue_events (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references agent_identities(id),
  intent_id     text not null references agent_payment_intents(id),
  skill         text not null,
  gross_amount  bigint not null,
  fee_amount    bigint not null,
  net_amount    bigint not null,
  currency_mint text not null,
  chain         text not null,
  payer_address text,
  created_at    timestamptz not null default now()
);

create index if not exists agent_revenue_events_agent_created
  on agent_revenue_events (agent_id, created_at desc);

create index if not exists agent_revenue_events_intent_id
  on agent_revenue_events (intent_id);

create table if not exists agent_payout_wallets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  agent_id   uuid references agent_identities(id) on delete set null,
  address    text not null,
  chain      text not null default 'solana',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, agent_id, chain)
);

create index if not exists agent_payout_wallets_user_id
  on agent_payout_wallets (user_id);

create table if not exists agent_withdrawals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id),
  agent_id      uuid references agent_identities(id),
  amount        bigint not null,
  currency_mint text not null,
  chain         text not null,
  to_address    text not null,
  status        text not null default 'pending',
  tx_signature  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists agent_withdrawals_user_status
  on agent_withdrawals (user_id, status);

commit;
