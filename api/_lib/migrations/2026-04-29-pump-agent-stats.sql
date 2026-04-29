-- Migration: per-agent pump.fun token live stats.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-29-pump-agent-stats.sql
-- Idempotent.
--
-- Writers: api/cron/pump-agent-stats.js
-- Readers: api/agents/solana-card.js, agent-passport.html

begin;

create table if not exists pump_agent_stats (
    mint_id           uuid primary key references pump_agent_mints(id) on delete cascade,
    network           text not null check (network in ('mainnet','devnet')),
    mint              text not null,
    graduated         boolean not null default false,
    bonding_curve     jsonb,         -- { real_sol, real_token, virtual_sol, virtual_token, complete, progress_pct }
    amm               jsonb,         -- { pool, base_reserve, quote_reserve, lp_supply }
    last_signature    text,
    last_signature_at timestamptz,
    recent_tx_count   int not null default 0,
    refreshed_at      timestamptz not null default now(),
    error             text
);
create index if not exists pump_agent_stats_network on pump_agent_stats(network);
create index if not exists pump_agent_stats_refreshed on pump_agent_stats(refreshed_at);

commit;
