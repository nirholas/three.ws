-- launch_match alert rules: "tell me when a new launch matches these filters".
--
-- pump_alert_rules gains a `filters` jsonb column and a `launch_match` kind.
-- The pumpfun-monitor runner evaluates launch_match rules against
-- pump_coin_intel, which scores every new pump.fun launch once its first
-- observation window closes. Supported filter keys (validated in
-- api/alerts/_rules.js, matched in api/_lib/pump-alert-eval.js):
--
--   name_pattern            "|"-separated alternatives, "*" wildcards, matched
--                           case-insensitively against the name or symbol
--   min_market_cap_usd      market cap at first sight, USD
--   max_market_cap_usd
--   min_safety_score        pump_coin_intel.quality_score, 0 to 100
--   min_creator_graduated   creator's earlier launches that graduated
--   max_creator_launches    creator's earlier launches in total (serial deployers)
--   exclude_risk_flags      drop launches carrying any of these risk flags
--   require_socials         at least one of twitter, telegram, website
--
-- Idempotent.

alter table pump_alert_rules add column if not exists filters jsonb;

alter table pump_alert_rules drop constraint if exists pump_alert_rules_kind_check;
alter table pump_alert_rules
	add constraint pump_alert_rules_kind_check
	check (kind in ('graduation', 'price_above', 'price_below', 'whale_buy', 'new_mint', 'market_price', 'launch_match'));
