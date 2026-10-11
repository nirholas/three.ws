-- Pulse archive schema. Everything is keyed by (chain, address) so Solana and
-- Robinhood Chain (and any chain added later) share one model. Time series
-- tables carry `ts` in their primary key so TimescaleDB can partition them.

-- Every token Pulse has ever seen, with its latest state and lifecycle.
create table if not exists tokens (
  chain              text not null,
  address            text not null,
  symbol             text,
  name               text,
  decimals           int,
  image              text,
  description        text,
  website            text,
  twitter            text,
  telegram           text,
  launchpad          text,
  creator            text,
  created_at         timestamptz,
  first_seen         timestamptz not null default now(),
  last_seen          timestamptz not null default now(),
  last_snapshot_at   timestamptz,
  category           text not null default 'unclassified',
  categories         text[] not null default '{}',
  tech_score         real not null default 0,
  classified_at      timestamptz,
  tags               text[] not null default '{}',
  verified           boolean,
  last_price         double precision,
  last_mcap          double precision,
  last_liquidity     double precision,
  last_volume_24h    double precision,
  last_holders       int,
  last_change_24h    real,
  first_mcap         double precision,
  ath_mcap           double precision,
  ath_at             timestamptz,
  peak_volume_24h    double precision,
  status             text not null default 'new',
  status_changed_at  timestamptz,
  graduated_at       timestamptz,
  died_at            timestamptz,
  primary key (chain, address)
);
create index if not exists tokens_status_idx on tokens (chain, status);
create index if not exists tokens_first_seen_idx on tokens (first_seen desc);
create index if not exists tokens_category_idx on tokens (category);
create index if not exists tokens_last_snapshot_idx on tokens (last_snapshot_at);

-- Point-in-time market state per token, one row per collection cycle.
create table if not exists token_snapshots (
  ts                 timestamptz not null,
  chain              text not null,
  address            text not null,
  price_usd          double precision,
  mcap               double precision,
  fdv                double precision,
  liquidity          double precision,
  vol_5m             double precision,
  vol_1h             double precision,
  vol_6h             double precision,
  vol_24h            double precision,
  buy_vol_24h        double precision,
  sell_vol_24h       double precision,
  organic_vol_24h    double precision,
  buys_1h            int,
  sells_1h           int,
  buys_24h           int,
  sells_24h          int,
  traders_1h         int,
  traders_24h        int,
  net_buyers_24h     int,
  holders            int,
  holder_change_24h  real,
  top_holders_pct    real,
  organic_score      real,
  chg_5m             real,
  chg_1h             real,
  chg_6h             real,
  chg_24h            real,
  source             text not null,
  primary key (chain, address, ts)
);
create index if not exists token_snapshots_ts_idx on token_snapshots (ts desc);

-- Which discovery list surfaced a token, at what rank, when.
create table if not exists list_appearances (
  ts       timestamptz not null,
  chain    text not null,
  list     text not null,
  rank     int not null,
  address  text not null,
  primary key (chain, list, address, ts)
);

-- DEX pools per token.
create table if not exists pairs (
  chain          text not null,
  address        text not null,
  token_address  text not null,
  dex            text,
  quote_symbol   text,
  labels         text[] not null default '{}',
  created_at     timestamptz,
  url            text,
  primary key (chain, address)
);
create index if not exists pairs_token_idx on pairs (chain, token_address);

-- Launches, graduations and pool creations, straight from chain events.
create table if not exists launch_events (
  ts         timestamptz not null,
  chain      text not null,
  kind       text not null,
  token      text not null,
  launchpad  text,
  actor      text,
  tx         text,
  name       text,
  symbol     text,
  data       jsonb,
  primary key (chain, kind, token)
);
create index if not exists launch_events_ts_idx on launch_events (ts desc);

-- Individual trades kept for watched wallets, whales and early buyers of runners.
create table if not exists trades (
  ts            timestamptz not null,
  chain         text not null,
  tx            text not null,
  token         text not null,
  wallet        text not null,
  side          text not null,
  quote_amount  double precision not null,
  token_amount  double precision not null,
  price_quote   double precision,
  mcap_usd      double precision,
  venue         text,
  reason        text,
  primary key (chain, tx, token, wallet, side, ts)
);
create index if not exists trades_wallet_idx on trades (chain, wallet, ts desc);
create index if not exists trades_token_idx on trades (chain, token, ts desc);

-- Labelled wallets: KOLs, smart money (imported and discovered), whales.
create table if not exists wallets (
  chain       text not null,
  address     text not null,
  label       text,
  kind        text not null,
  source      text not null,
  twitter     text,
  telegram    text,
  first_seen  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  meta        jsonb not null default '{}',
  primary key (chain, address)
);
create index if not exists wallets_kind_idx on wallets (kind);

-- Running per-wallet, per-token positions, aggregated from the trade stream.
create table if not exists wallet_positions (
  chain               text not null,
  wallet              text not null,
  token               text not null,
  first_buy_at        timestamptz,
  first_buy_mcap_usd  double precision,
  last_trade_at       timestamptz not null,
  buys                int not null default 0,
  sells               int not null default 0,
  bought_quote        double precision not null default 0,
  sold_quote          double precision not null default 0,
  bought_tokens       double precision not null default 0,
  sold_tokens         double precision not null default 0,
  primary key (chain, wallet, token)
);
create index if not exists wallet_positions_token_idx on wallet_positions (chain, token);
create index if not exists wallet_positions_recent_idx on wallet_positions (last_trade_at desc);

-- Rolling wallet performance, recomputed from positions.
create table if not exists wallet_scores (
  chain             text not null,
  wallet            text not null,
  computed_at       timestamptz not null,
  window_days       int not null,
  tokens_traded     int not null,
  wins              int not null,
  win_rate          real not null,
  invested_quote    double precision not null,
  realized_quote    double precision not null,
  unrealized_quote  double precision not null,
  pnl_quote         double precision not null,
  pnl_usd           double precision,
  early_hits        int not null,
  best_multiple     real,
  score             real not null,
  primary key (chain, wallet)
);
create index if not exists wallet_scores_score_idx on wallet_scores (score desc);

-- Chain-wide aggregates per collection cycle.
create table if not exists market_snapshots (
  ts                  timestamptz not null,
  chain               text not null,
  native_usd          double precision,
  tracked_tokens      int,
  total_mcap          double precision,
  total_volume_24h    double precision,
  launches_1h         int,
  graduations_1h      int,
  stream_trades_1h    int,
  stream_volume_1h    double precision,
  data                jsonb not null default '{}',
  primary key (chain, ts)
);

-- Daily newsletters: the data behind them and the rendered issue.
create table if not exists daily_reports (
  day           date primary key,
  generated_at  timestamptz not null default now(),
  data          jsonb not null,
  markdown      text not null,
  html          text not null,
  telegram      jsonb
);

-- Key/value state for cursors and checkpoints (block heights, last runs).
create table if not exists kv (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
