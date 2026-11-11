---
name: kol-wallet-lookup
description: Look up one tracked KOL (smart trader) Solana wallet through the kol-mcp server: its portfolio value, realized P&L, win rate and its recent trades on a given token mint. Read-only, no key or payment.
---

# KOL wallet lookup with kol-mcp

The plugin starts `@three-ws/kol-mcp` over stdio (`npx -y @three-ws/kol-mcp`). Tools appear as `mcp__kol-mcp__<tool>`. Both tools are read-only calls to the public three.ws API. No API key, signer or payment is involved.

## Environment

- `THREE_WS_BASE`: API host, default `https://three.ws`.
- `THREE_WS_TIMEOUT_MS`: request timeout, default `20000`.

## Tools

- `get_wallet_portfolio` (`wallet`): calls `GET /api/kol/wallets?addresses=<wallet>`. Returns `portfolio_value_usd`, `holdings`, `top_token`, `realized_pnl_usd`, `win_rate`, `total_trades`, `volume_usd`, `pnl_source` and `pnl_window` (30 days).
- `get_wallet_trades` (`wallet`, `mint`, `limit` 1-100, default 20): calls `GET /api/kol/trades?mint=<mint>` and keeps the rows for that wallet, newest first, with side, SOL size, token amount, price and time.

## Reading the results

- A `null` P&L field with `pnl_source: null` means three.ws has no trade history for that wallet in the window. Report it as unknown, never as zero profit.
- `has_activity: false` means the wallet has no holdings and no trades.
- An `upstream_unavailable` error is a provider outage, not an empty wallet. Retry later.
- `get_wallet_trades` scans the most recent 100 trades on the mint across tracked wallets, so an older trade by the wallet may not appear.

## Example

User: "How is this trader doing, and what are they doing in token X?"

1. `get_wallet_portfolio` with `wallet: "<address>"`, then summarize value, realized P&L and win rate.
2. `get_wallet_trades` with the same `wallet`, `mint: "<token mint>"`, `limit: 20`, then describe the buys and sells in order.
