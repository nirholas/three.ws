# 30. Trading tool parity: every trading surface as a tool, plus arbitrage, token search, portfolio, news and allowlist tools

Read `docs/prompts/README.md` first.

## The problem

Swaps, DCA (`api/dca-strategies.js`), limit and trailing orders (`api/agents/orders.js`), launch trading (`api/pump/[action].js`), the allowlist (`api/agent/guard.js`) and portfolio views exist as routes and pages but are not uniformly exposed as MCP tools and SDK methods. Missing outright: cross-venue arbitrage quotes, a token search tool with safety data, a news feed tool, and a single portfolio tool with PnL.

## Build

On the unified endpoint under the prompt 03 policy, and in the SDK from prompt 06:

- **Trading:** `token_search` (symbol or name to mint, with liquidity, age, holder concentration, mint and freeze authority, safety score from the diligence skill in prompt 04), `get_price`, `swap_quote`, `swap_execute` (`confirm_swap`), `get_portfolio` (all holdings with cost basis and realized and unrealized PnL from the custody ledger), `get_market_signals`, `get_indicators`, `arbitrage_prices` (the same pair across every venue we can quote) and `arbitrage_quote` (a two-leg route with expected profit after fees; execution goes through `swap_execute` twice with previews).
- **DCA and orders:** `dca_create` (`confirm_dca`), `dca_list`, `dca_cancel`, `limit_order_create` (`confirm_order`), `limit_order_cancel`, `limit_order_history`, `trailing_order_create`.
- **Launch trading:** `launch_buy` and `launch_sell` over the existing two-phase prep and confirm.
- **Allowlist:** `get_whitelist`, `add_to_whitelist` (`confirm_allowlist`), `remove_from_whitelist`.
- **Wallet:** `wallet_transfer` (`confirm_transfer`, destination must be allowlisted), `get_transactions`, `get_wallet_history`.
- **News:** `get_news_feed` over the aggregated news the intelligence surfaces already fetch, filterable by token.
- Every tool has a page that shows the same data; where a page is missing (arbitrage), add it to the cockpit.
- Docs: `docs/trading-surfaces.md` gains the tool table; `docs/api-reference.md`; changelog entry tagged `feature`.

## Acceptance

- `token_search` for a symbol returns the mint with a safety score; `arbitrage_prices` for a liquid pair returns at least two venues.
- Every financial tool refuses without its confirm flag and a fresh preview.
- `npm test` green.
