-- Prediction markets from the agent wallet (api/_lib/predictions/).
--
-- 1. prediction_previews: every fund-moving prediction action (open, close,
--    redeem) is priced first by a preview, and the execution call must present
--    that preview's id. A preview is bound to one agent and one action, lives
--    ten minutes, and is consumed by the execution it authorizes, so a stale or
--    replayed preview can never move money.
--
--      kind        open | close | redeem
--      params      what the owner asked for (market, side, stake, limit price)
--      quote       what the preview showed (fill estimate, fees, guards)
--      consumed_at set atomically by the execution that uses the preview
--
-- 2. market_price alert rules: pump_alert_rules gains a `market_price` kind that
--    watches one outcome of one prediction market and fires when its implied
--    probability crosses `threshold` (0 to 1) in `direction`. The same monitor
--    cron that evaluates the pump rules evaluates these, and they deliver over
--    the same in-app, webhook and Telegram channels. `target_agent_scope`
--    records the agent whose predictions page set the watch, so that page can
--    list its own watches; it is separate from `target_agent`, which already
--    means "the agent whose launches a new_mint rule follows".

create table if not exists prediction_previews (
	id           uuid primary key default gen_random_uuid(),
	agent_id     uuid not null references agent_identities(id) on delete cascade,
	user_id      uuid references users(id) on delete cascade,
	venue        text not null,
	kind         text not null check (kind in ('open', 'close', 'redeem')),
	params       jsonb not null default '{}'::jsonb,
	quote        jsonb not null default '{}'::jsonb,
	created_at   timestamptz not null default now(),
	expires_at   timestamptz not null,
	consumed_at  timestamptz
);

create index if not exists prediction_previews_agent_created
	on prediction_previews (agent_id, created_at desc);

alter table pump_alert_rules
	add column if not exists target_market text,
	add column if not exists target_side   text check (target_side in ('yes', 'no')),
	add column if not exists direction     text check (direction in ('above', 'below')),
	add column if not exists target_agent_scope uuid references agent_identities(id) on delete set null;

alter table pump_alert_rules drop constraint if exists pump_alert_rules_kind_check;
alter table pump_alert_rules
	add constraint pump_alert_rules_kind_check
	check (kind in ('graduation', 'price_above', 'price_below', 'whale_buy', 'new_mint', 'market_price'));

create index if not exists pump_alert_rules_market
	on pump_alert_rules (target_market) where kind = 'market_price';
