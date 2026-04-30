# Task: Replace the KOL wallet P&L stub with live on-chain data

## Context

The project is three.ws — a platform for 3D AI agents with Pump.fun/Solana trading capabilities.

The repo is at `/workspaces/3D-Agent`.

**What exists:**

- `src/kol/wallets.js` — Key Opinion Leader (KOL) wallet tracking. At line 2, there is a comment:
  ```js
  // TODO: replace stub with dynamic source (on-chain P&L indexer, Dune, Birdeye)
  ```
  This means the KOL wallet data is currently hardcoded or returns mock data.

- `api/` — Backend API. Check if there's an existing wallet analytics endpoint.

- The project already uses Pump.fun APIs (`api/pump-fun-mcp.js`) and Solana Web3 (`@solana/web3.js`). Birdeye is a Solana wallet/token analytics API that provides P&L data.

**The goal:** Replace the stub in `src/kol/wallets.js` with live data from Birdeye's wallet P&L API.

---

## Before starting

Read `src/kol/wallets.js` in full to understand:
- What data structure it currently returns
- How it's consumed by the KOL leaderboard or agent skill (check who imports it)
- What "P&L" fields are needed (realized P&L, unrealized P&L, win rate, etc.)

Also read any existing KOL-related files:
- Any KOL skills in `src/skills/`
- `prompts/repo-integrations/13-wallet-pnl-skill.md` — this prompt may have already designed the integration
- `prompts/repo-integrations/11-kol-quest-smart-money-widget.md` — related widget

---

## Birdeye API

Birdeye provides a Solana wallet analytics API. Key endpoint:

```
GET https://public-api.birdeye.so/v1/wallet/portfolio
Headers: X-API-KEY: {BIRDEYE_API_KEY}
Params: wallet={walletAddress}&chain=solana
```

Returns portfolio with token holdings, prices, and P&L data.

For wallet trading history / realized P&L:
```
GET https://public-api.birdeye.so/v1/wallet/tx_list
Params: wallet={walletAddress}&chain=solana&tx_type=swap
```

---

## Architecture

### Backend endpoint

Create `api/kol/wallets.js` (or `api/kol/[wallet].js`) that proxies Birdeye:

```
GET /api/kol/wallets?addresses=addr1,addr2,...
```

- Takes a comma-separated list of wallet addresses
- Fetches portfolio + P&L from Birdeye for each
- Returns normalized P&L data
- Server-side only (Birdeye API key never sent to browser)
- Cache results for 60 seconds (use Upstash Redis if available, or in-memory `Map` with TTL)

Auth: can be public (read-only leaderboard data) or require session — match whatever the existing KOL UI expects.

### Frontend

Update `src/kol/wallets.js` to:
1. Remove the stub/hardcoded data
2. Fetch from `/api/kol/wallets?addresses=...`
3. Return the live P&L data in the same shape the callers expect

The data shape (confirm against actual current shape in the file):
```js
{
  address: '...',
  displayName: '...',      // from existing config or ENS/SNS
  realizedPnl: 1234.56,    // USD
  unrealizedPnl: 789.01,
  winRate: 0.73,           // 0-1
  totalTrades: 142,
  topToken: { symbol: 'BONK', pnl: 500.00 },
}
```

---

## Files to create/edit

**Create:**
- `api/kol/wallets.js` — Birdeye proxy endpoint

**Edit:**
- `src/kol/wallets.js` — replace stub with fetch to backend

**Do not touch:**
- Any KOL UI components — the data shape must match what they already expect
- `api/pump-fun-mcp.js`

---

## Environment variables

- `BIRDEYE_API_KEY` — required. Add to `.env.example` if one exists.

---

## Acceptance criteria

1. With a real Solana wallet address that has trading history, `GET /api/kol/wallets?addresses=<addr>` returns non-zero P&L data.
2. The KOL leaderboard/widget shows live data instead of stubs.
3. The endpoint returns cached data on the second call within 60s (check response time or add a cache-hit header).
4. Without `BIRDEYE_API_KEY`, the endpoint returns `503` with `{ error: 'birdeye_not_configured' }`.
5. `npx vite build` passes. `node --check api/kol/wallets.js` passes.

## Constraints

- `BIRDEYE_API_KEY` must never be sent to the browser.
- Cache responses: Birdeye rate-limits free-tier keys to 100 req/min.
- If Birdeye returns an error for a specific wallet, return partial data for the other wallets rather than failing the whole request.
- No new npm dependencies — use `fetch` for the Birdeye API call.
- Match the existing data shape consumed by callers of `src/kol/wallets.js` exactly.
