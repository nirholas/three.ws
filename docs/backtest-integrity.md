# Backtest integrity

A backtest number is only worth showing if it can be trusted and repeated. Three checks run on every sniper backtest (`POST /api/sniper/backtest`) and a fourth keeps research code away from live trading.

## Look-ahead audit

`auditLookahead` in [api/_lib/backtest-integrity.js](../api/_lib/backtest-integrity.js) replays a decision function twice per audited point: once with the full series and once with everything after that point removed. If the decision changes, it used future data. The result lists the offending indexes.

For the sniper backtest, the decision is the entry gate (`scoreMint` or `scoreIntel`, the same call the live worker makes) for each captured launch, so `auditBacktestLookahead` in [api/_lib/strategy-backtest.js](../api/_lib/strategy-backtest.js) audits the real gate. Creator history counters (launches and graduations before this launch) are also checked for causality: for one creator they must rise with every earlier launch, never stall or fall. Series longer than 400 decisions are sampled on an even stride that always includes the first and last decision (`checked` vs `total` in the report).

The result sits under `integrity.lookahead` in the response and is shown on the Strategy tab of the wallet hub and in the strategy settings backtest panel.

## Dataset manifests

Each backtest records `integrity.manifest`: dataset id (table, network, window), source, range, row count and a SHA-256 over the fields that determine the result. Two runs with the same hash saw the same data. A snapshot without a complete manifest (every one saved before this shipped) comes back with `reproducible: false` and an `unreproducible_reason`; the UI says to run it again.

## Canaries

`/api/cron/data-canary` runs every 30 minutes ([api/cron/data-canary.js](../api/cron/data-canary.js), schedule in `vercel.json`). It probes:

- every SOL/USD price provider in [api/_lib/sol-price.js](../api/_lib/sol-price.js): positive and within 5% of the median of all answering providers;
- a closed historical daily SOL/USD candle (2025-01-01 UTC) on Kraken and Coinbase: right timestamp, consistent OHLC, close within 2% of the reference.

Verdicts are stored in the shared cache ([api/_lib/data-canary-health.js](../api/_lib/data-canary-health.js)). `orderByCanary` sorts a provider list: recently passing sources first, never-probed or stale ones in configured order, failing ones last. Nothing is ever dropped from a chain. It is applied to the SOL price chain and the coin chart candle chain.

Register the schedule with the usual `npm run create:gcp-scheduler` flow at the next deploy; the entry is in `vercel.json` only.

## Research/live wall

Research modules receive a `ResearchContext` ([api/_lib/research-context.js](../api/_lib/research-context.js)): a frozen, read-only view of a recorded dataset and its manifest. It has no signing, wallet, order, network or database function.

`RESEARCH_MODULES` lists the files on the research side. [scripts/lib/research-wall.mjs](../scripts/lib/research-wall.mjs) follows their static and literal dynamic imports transitively and reports any path into a live execution module (execution engine, wallets, custody, signers, the sniper executor, order and swap modules) or a signing package, with the import chain. `tests/backtest-integrity.test.js` fails the suite on any violation. Add a new backtest or research file to `RESEARCH_MODULES`.

Tests: [tests/backtest-integrity.test.js](../tests/backtest-integrity.test.js).
