-- Agent portfolio snapshots: the time series behind get_balance_history.
--
-- getPortfolio (api/_lib/portfolio.js) values an agent wallet live, but nothing
-- kept the answer, so "how has this agent's net worth moved" had no source.
-- api/_lib/portfolio-history.js writes one row per agent per network whenever a
-- valuation is taken (the MCP portfolio tools, the /api/v1/agents/:id/portfolio
-- route, and the hourly /api/cron/agent-portfolio-snapshots sweep over recently
-- active agents), throttled to one row per 15 minutes so a polling client cannot
-- grow the table faster than the cron does.
--
-- Values are the real valuation at captured_at: native SOL plus every priceable
-- SPL holding, realized P&L from the trade ledger, unrealized P&L on open FIFO
-- lots. Idempotent.

create table if not exists agent_portfolio_snapshots (
    id                  bigserial primary key,
    agent_id            uuid not null references agent_identities(id) on delete cascade,
    network             text not null default 'mainnet' check (network in ('mainnet','devnet')),
    captured_at         timestamptz not null default now(),
    net_worth_sol       double precision not null,
    net_worth_usd       double precision,
    sol_usd             double precision,
    realized_pnl_sol    double precision,
    unrealized_pnl_sol  double precision,
    holdings_count      integer not null default 0,
    source              text not null default 'read' check (source in ('read','cron'))
);

create index if not exists agent_portfolio_snapshots_agent_time
    on agent_portfolio_snapshots (agent_id, network, captured_at desc);
