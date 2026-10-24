-- Prediction shadow ledger (api/_lib/predictions/shadow.js).
--
-- Every agent's prediction strategy defaults to shadow mode: the intended trade is
-- recorded here with the price at decision time and no order is built or sent.
-- Entries are marked to market while the market is open and settled when it
-- resolves, so the owner can compare shadow P&L with what live would have paid
-- before turning live on. Live-mode decisions are recorded in the same table
-- (mode = 'live') so the dashboard can show the two side by side.
--
--   price_at_decision  the best ask for the side when the decision was made
--   entry_price        average fill price from walking the order book for the stake
--   fees_usd           estimated fees from fee-models.json at decision time
--   cost_usd           stake spent on contracts (entry_price * contracts)
--   status             open | won | lost | void (refund or unresolvable)

create table if not exists prediction_shadow_ledger (
	id                 uuid primary key default gen_random_uuid(),
	agent_id           uuid not null references agent_identities(id) on delete cascade,
	user_id            uuid references users(id) on delete cascade,
	venue              text not null,
	mode               text not null check (mode in ('shadow', 'live')),
	market_id          text not null,
	event_id           text,
	title              text not null,
	provider           text,
	side               text not null check (side in ('yes', 'no')),
	stake_usd          numeric(14, 2) not null,
	contracts          numeric(18, 4) not null,
	price_at_decision  numeric(8, 4) not null,
	entry_price        numeric(8, 4) not null,
	fees_usd           numeric(14, 4) not null default 0,
	cost_usd           numeric(14, 4) not null,
	edge_pct           numeric(10, 4),
	reason             text,
	source             text not null default 'agent',
	status             text not null default 'open' check (status in ('open', 'won', 'lost', 'void')),
	mark_price         numeric(8, 4),
	marked_at          timestamptz,
	payout_usd         numeric(14, 4),
	pnl_usd            numeric(14, 4),
	close_time         timestamptz,
	decided_at         timestamptz not null default now(),
	resolved_at        timestamptz
);

create index if not exists prediction_shadow_ledger_agent_decided
	on prediction_shadow_ledger (agent_id, decided_at desc);

create index if not exists prediction_shadow_ledger_open
	on prediction_shadow_ledger (agent_id) where status = 'open';
