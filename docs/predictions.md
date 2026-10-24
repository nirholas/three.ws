# Agent Predictions: shadow mode and the no-arbitrage scanner

Agents trade USDC prediction markets on Solana through the engine in `api/_lib/predictions/` (see [mcp-agent.md](./mcp-agent.md) for the trading tools). This page covers the layer on top: a **shadow ledger** that records what a strategy would have done at the live price, and a **scanner** that looks for a YES plus NO pair that costs less than the $1 it pays.

Nothing here moves funds. Order build and quote stay in the existing open/close routes, which keep their own limits, previews and confirmations.

## Shadow mode

Every agent's strategy defaults to `shadow`. A decision posted in shadow mode is priced against the live order book (walking the asks for the stake, including the venue and provider fee from the fee model), written to the `prediction_shadow_ledger` table, and marked later from the market's current or resolved price. No order is built.

`live` mode is an owner-session-only setting. In live mode a decision is still recorded and returns the engine's preview. The owner confirms the execute separately through the normal open route, so a strategy can never spend on its own.

Read the results side by side: the summary reports shadow and live separately, each with decisions, staked, realized and unrealized P&L, P&L before and after fees and slippage, and win rate.

## Scanner

`GET /api/predictions/scan` reads the most active open markets, fetches order books for the ones whose YES plus NO prices sit near par, and reports for each the gross edge (`1 - yes_ask - no_ask`), the net edge after fees, and how much is fillable at positive net edge. `executable` is true only when the net edge clears the thresholds in the fee model file. A negative edge is the normal state of an efficient market, and the scanner says so rather than inventing opportunities.

## Fee models

`api/_lib/predictions/fee-models.json` holds the venue fee, per-provider fee schedules, scanner thresholds and strategy defaults. It is data: edit it, or pass an override to the scanner. Fee kinds: `bps_of_notional`, `p_one_minus_p` and `flat_per_contract`. The shipped venue fee is a conservative allowance. Replace it with the venue's measured fee (the quote's `fees_usd` on a preview) before relying on a small edge.

## Routes

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/predictions/scan` | public | Scanner results |
| `GET /api/v1/agents/:id/predictions/strategy` | owner | Mode, stake cap and edge floor |
| `PUT /api/v1/agents/:id/predictions/strategy` | owner session | Change mode or limits (live needs a browser session) |
| `GET /api/v1/agents/:id/predictions/shadow` | owner | Ledger entries and shadow versus live summary |
| `POST /api/v1/agents/:id/predictions/shadow/intent` | owner or key | Record one decision |

## Dashboard

[/agent-predictions](https://three.ws/agent-predictions), or `/agents/<agent id>/predictions`: strategy card with the mode toggle, shadow and live result cards, the decision table, and the scanner. Without an agent id only the scanner shows.

## Tests

`npx vitest run tests/predictions-shadow.test.js tests/predictions-book.test.js`. The ledger migration is `api/_lib/migrations/20261024020000_prediction_shadow_ledger.sql` and applies at deploy.
