# 13 — Wallet P&L analytics skill

**Branch:** `feat/wallet-pnl-skill`
**Source repo:** https://github.com/nirholas/kol-quest
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

"How is wallet X doing?" is the most common question users ask about a smart-money wallet. kol-quest implements the P&L math; this prompt ports a single-wallet P&L skill so the 3D agent can answer it directly.

## Read these first

| File | Why |
| :--- | :--- |
| [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js) | Skill registration. |
| [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js) | MCP tool registration. |
| https://github.com/nirholas/kol-quest | P&L math reference. |

## Build this

1. Add `src/kol/wallet-pnl.js` exporting:
    ```js
    export async function getWalletPnl({ wallet, window = '7d' })
    // window ∈ '24h' | '7d' | '30d' | 'all'
    // Returns { wallet, window, realizedUsd, unrealizedUsd, totalUsd, winRate, trades, openPositions: [...] }
    ```
2. Register skill `kol.walletPnl` in [src/agent-skills-pumpfun.js](../../src/agent-skills-pumpfun.js).
3. Register MCP tool `kol_wallet_pnl` in [api/pump-fun-mcp.js](../../api/pump-fun-mcp.js).
4. Add `tests/kol-wallet-pnl.test.js` mocking trade history and asserting realized vs unrealized math is correct against a known fixture (write a simple FIFO-cost test case).

## Out of scope

- A wallet-PnL widget (UI). Skill + MCP only.
- Cross-chain — Solana only.
- Tax accounting / cost-basis edge cases beyond FIFO.

## Acceptance

- [ ] `node --check src/kol/wallet-pnl.js` passes.
- [ ] `npx vitest run tests/kol-wallet-pnl.test.js` passes.
- [ ] Skill + MCP tool callable.
- [ ] `npx vite build` passes.

## Test plan

1. Call the skill against a known active wallet; confirm a coherent number.
2. Compare to a manual spot-check (one or two trades).
3. Pass an empty wallet; confirm `realizedUsd === 0` and no error.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
