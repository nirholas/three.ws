# Market anomaly feed

A scanner that scores real market series for statistically unusual moves and records each one as an event. Events are read through a paid x402 endpoint and through the `market_anomaly` alert rule kind.

## What is scanned

| Processor | Series | Source | Cadence |
|---|---|---|---|
| `price` | Top 100 coins, 7 day hourly sparkline | CoinGecko markets table | hourly points |
| `tvl` | Solana DeFi TVL, last 120 days | DeFiLlama | daily |
| `stablecoin_supply` | Solana stablecoin circulating supply, last 120 days | DeFiLlama | daily |
| `stablecoin_peg` | Top 100 stablecoins vs $1 (USD pegs with at least $10M circulating) | `buildStablecoins()` | spot |
| `funding` | Top 20 Hyperliquid perps, 7 days of funding history (8h-equivalent percent) | Hyperliquid `fundingHistory` | hourly |
| `open_interest` | Top 20 Hyperliquid perps open interest | Hyperliquid, snapshotted each tick into `market_anomaly_samples` | 15 min |

Gas and whale processors are not part of this feed: gas is EVM-only and whale detection already lives in the wallet and Oracle surfaces.

## Detectors

[api/_lib/market-anomaly.js](../api/_lib/market-anomaly.js) is pure (no network, no clock). For each series it builds overlapping lookback returns and scores the latest one:

- **Modified z-score**: median and MAD, scaled by 0.6745, threshold 3.5. Falls back to mean absolute deviation when MAD is 0, and refuses a constant history.
- **EWMA deviation**: lambda 0.2, threshold 3.
- **Rate of change**: the move in percent, gated by a per-series minimum.

Severity is the lower of the score rung and the move rung, so a large z-score on a tiny move is never reported. A series with fewer than `MIN_POINTS` (24) plus the lookback is skipped as `insufficient_history`; a series with no variance is skipped as `flat_history`. Every skip is logged with its reason and returned by the cron.

Events dedupe on `event_key` (`processor:subject:metric:bucket`), so a condition that persists writes one event per bucket, not one per tick.

## Reading events

`GET /api/x402/market-anomalies` ($0.001 USDC, Solana or Base). Parameters: `processor`, `severity` (minimum, default `medium`), `subject`, `hours` (1-168, default 24), `limit` (1-200, default 50). Bad params are a 422 and a store outage is a 503; neither charges the buyer.

## Alerts

Create a rule of kind `market_anomaly` (REST `POST /api/alerts/rules`, or `create_alert_rule` in [packages/alerts-mcp](../packages/alerts-mcp/README.md)). Optional `filters`: `processors`, `min_severity` (default `high`), `subject`. It takes no target mint. The alert runner delivers each new event once per rule.

## Operations

Cron `/api/cron/market-anomalies` runs every 15 minutes (see `vercel.json`). It runs the six processors in parallel with per-processor error isolation and returns `{scored, detected, written, skipped, skipped_detail, errors}`; it is `ok` unless every processor failed. Open interest needs 29 snapshots (about 7 hours) before it scores. Tests: [tests/market-anomaly.test.js](../tests/market-anomaly.test.js), using series recorded from the live upstreams in `tests/fixtures/market-anomaly/`.
