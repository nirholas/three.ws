# 09. Prediction markets from the agent wallet

Read `docs/prompts/README.md` first.

## The problem

There is no prediction-market surface. The only related material is vendored third-party client skills under `.agents/skills/okx-*`, which are not ours and do not touch the agent wallet. An agent that can research an event cannot take a position on it.

## Build

### Venue

Pick a Solana-native prediction market first (an on-chain program with a public SDK and USDC-settled binary or categorical markets). If no Solana venue meets a minimum liquidity bar you define and record, ship the Solana research and watch surfaces fully and add the execution leg on the venue that exists, keeping the interface venue-agnostic in `api/_lib/predictions/index.js`. State the position plainly in the docs and the report; Solana remains the default and is never demoted.

### Routes and tools

Under `api/v1/agents/:id/predictions/` with MCP tools under the prompt 03 policy:

- `events` (`predictions_events`): browse and search events with outcomes, prices as implied probabilities, volume, liquidity, resolution time and source.
- `event/:id` (`predictions_event`): detail with price history.
- `positions` (`predictions_positions`): the agent's open and settled positions with PnL.
- `open/preview` and `open` (`predictions_open`, financial, `confirm_trade`, fresh `preview_id`): outcome, size in USDC, max price, returns expected shares, fees and slippage.
- `close/preview` and `close` (`predictions_close`, financial, `confirm_trade`).
- `redeem` (`predictions_redeem`, financial, `confirm_trade`) for resolved markets.
- `watch` (`predictions_watch`): an alert rule type `market_price` in `api/alerts/_rules.js` evaluated by the existing monitor cron.

Guards: per-agent max stake per market and per day in `api/_lib/agent-trade-guards.js`; the anomaly freeze applies.

### UI

`/predictions` browse page and `/agents/:id/predictions` positions page (both in `data/pages.json`): search, categories, probability charts (follow the `dataviz` skill), order ticket with preview then confirm, positions with PnL, watch buttons. Every state designed.

## Docs and wiring

`docs/predictions.md` (new) linked from `docs/start-here.md`; `docs/api-reference.md` section; `STRUCTURE.md` rows; `data/changelog.json` entry tagged `feature`.

## Acceptance

- Browse and detail work unauthenticated; opening a position previews and stops at the owner confirmation table (gate 1).
- A watch rule fires a notification when a market crosses the threshold (test with a live market and a threshold just past the current price).
- `npm test` green with fixtures recorded from the real venue API.
