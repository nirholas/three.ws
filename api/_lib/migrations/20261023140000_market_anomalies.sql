begin;

-- Market anomaly feed (api/_lib/market-anomaly.js, api/cron/market-anomalies.js).
--
-- market_anomaly_events: one row per detected anomaly. event_key is the dedupe
-- key (processor:subject:metric:time-bucket), so a condition that persists across
-- cron ticks writes one event per bucket instead of one per tick.
create table if not exists market_anomaly_events (
    id           bigserial    primary key,
    event_key    text         not null unique,
    processor    text         not null,   -- price | tvl | stablecoin_supply | stablecoin_peg | funding | open_interest
    subject      text         not null,   -- coin id, chain, stablecoin symbol, perp symbol
    metric       text         not null,
    severity     text         not null check (severity in ('medium', 'high', 'critical')),
    direction    text         not null check (direction in ('up', 'down')),
    value        double precision,
    baseline     double precision,
    change_pct   double precision,
    score        double precision,
    detectors    jsonb        not null default '[]'::jsonb,
    summary      text         not null,
    observed_at  timestamptz  not null,
    created_at   timestamptz  not null default now()
);

create index if not exists market_anomaly_events_recent on market_anomaly_events (created_at desc);
create index if not exists market_anomaly_events_processor on market_anomaly_events (processor, created_at desc);

-- market_anomaly_samples: snapshots of series that have no public history
-- (perp open interest). The cron appends one row per subject per tick and the
-- open_interest processor scores the accumulated series; pruned to 14 days.
create table if not exists market_anomaly_samples (
    metric       text         not null,
    subject      text         not null,
    sampled_at   timestamptz  not null default now(),
    value        double precision not null,
    primary key (metric, subject, sampled_at)
);

-- Alert rules gain the market_anomaly kind. Its options live in the existing
-- `filters` jsonb (processors, min_severity, subject).
alter table pump_alert_rules drop constraint if exists pump_alert_rules_kind_check;
alter table pump_alert_rules
    add constraint pump_alert_rules_kind_check
    check (kind in ('graduation', 'price_above', 'price_below', 'whale_buy', 'new_mint', 'market_price', 'launch_match', 'market_anomaly'));

commit;
