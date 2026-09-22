# 07. Perpetual futures from the agent wallet

Read `docs/prompts/README.md` first.

## The problem

Agents can swap, DCA, place limit and trailing orders (`api/agents/orders.js`), and trade launches, but cannot open a leveraged position. The only perps surface is derivatives market data in `api/coin/derivatives.js`. A trading agent with no perps venue cannot hedge, short, or run a macro strategy.

## Build

### Venue

Pick one Solana perps venue by these criteria and record the choice and rationale in your report: an on-chain program with a maintained TypeScript SDK on npm (published within the last 90 days), deep open interest on the SOL and BTC markets, and permissionless trader accounts. Integrate it in `api/_lib/perps/<venue>.js` behind a venue-agnostic interface in `api/_lib/perps/index.js` so a second venue is an added file. Never name the venue's token anywhere in committed code or docs; refer to it by the module name.

### Routes and tools

Under `api/v1/agents/:id/perps/` (prompt 05 family) with matching MCP tools on `/api/mcp-agent` registered under the prompt 03 policy:

- `markets` (`perps_markets`): every market with funding, open interest, mark and index price, max leverage.
- `market-data` (`perps_market_data`): order book depth, recent trades, funding history for one market.
- `account` (`perps_account`): the agent's trader account, collateral, positions with unrealized PnL, liquidation prices, open orders.
- `account/prepare` (`perps_account_prepare`, financial, `confirm_deposit`): create the trader account and any required token accounts; preview the rent and fees first.
- `trader/register` (`perps_trader_register`, financial) if the venue needs it.
- `collateral/deposit` and `collateral/withdraw` (`perps_collateral_deposit`, `perps_collateral_withdraw`, financial, `confirm_deposit` and `confirm_withdraw`), both subject to `enforceSpendLimit` and the allowlist for withdrawals to external addresses.
- `orders/preview` (`perps_order_preview`): market, side, size, leverage, order type (market, limit, reduce-only, take-profit, stop-loss), returns entry estimate, fees, liquidation price, margin impact, and a `preview_id`.
- `orders/execute` (`perps_order_execute`, financial, `confirm_trade`, requires a fresh `preview_id`).
- `orders/cancel` (`perps_order_cancel`, financial, `confirm_cancel`).
- `positions/close` (`perps_position_close`, financial, `confirm_trade`, previews first).

All signing goes through the agent wallet path in `api/agents/solana-wallet.js` and `api/_lib/solana-signers.js`; the custody event ledger (`agent_custody_events`) records every action with the signature.

### Risk guards

Extend `api/_lib/agent-trade-guards.js` with perps limits: max leverage per agent, max notional per position, max total margin as a share of the wallet, and a liquidation-distance floor below which `perps_order_execute` refuses. Defaults conservative; editable on the agent's wallet settings page with every state designed. The anomaly freeze in `api/agents/solana-guard.js` must also block perps actions.

### UI

- `/agents/:id/perps` page (add to `data/pages.json`): markets list, position table with live PnL over SSE, order ticket with preview before submit, collateral panel, and the risk settings. Skeleton loading, empty state ("no trader account yet" with the prepare action), error state with the failing step and recovery.
- The terminal cockpit in `docs/trading-surfaces.md` gains a perps tab.
- A `perps` automation action for prompt 05 automations (open or close on a price trigger) and a wallet intent action.

## Docs and wiring

- `docs/perps.md` (new) linked from `docs/start-here.md` and `docs/trading-surfaces.md`: how it works, risk limits, every route and tool, one worked example on a small position.
- `docs/api-reference.md` section. `STRUCTURE.md` row. `data/changelog.json` entry tagged `feature`.

## Acceptance

- Dry run on the QA account: prepare account, preview a minimal long, and stop at the confirmation table for the owner (gate 1). Do not execute without the yes.
- Guards: a preview exceeding max leverage returns the guard error, not a venue error.
- Tests mock nothing on-chain; they cover guard math, preview id expiry and the venue interface contract with recorded fixtures of real RPC responses. `npm test` green.
