---
name: pump-fun-mcp-guide
description: Guide to the Pump.fun MCP Server — read-only Solana token launchpad data for AI agents. Search tokens, analyze bonding curves, track trades, find trending launches, check graduation status, and evaluate creator profiles. Includes rug-pull red flags and holder concentration analysis.
license: MIT
metadata:
  category: trading
  difficulty: intermediate
  author: nich
  tags: [trading, pump-fun-mcp-guide]
---

# Pump.fun MCP Server Guide

A Cloudflare Worker implementing MCP Streamable HTTP that provides AI agents with read-only access to pump.fun's Solana token launchpad data.

## Tools (10)

| Tool | Description | Key Args |
|------|-------------|----------|
| `searchTokens` | Search by name, symbol, or mint | `query`, `limit`, `sort`, `order` |
| `getTokenDetails` | Full token info + social links | `mint` |
| `getBondingCurve` | Bonding curve reserves, price, graduation % | `mint` |
| `getTokenTrades` | Recent buy/sell trade history | `mint`, `limit`, `offset` |
| `getTrendingTokens` | Top tokens by market cap | `limit`, `includeNsfw` |
| `getNewTokens` | Most recently launched tokens | `limit` |
| `getGraduatedTokens` | Tokens that graduated to Raydium AMM | `limit` |
| `getKingOfTheHill` | Highest mcap token still on bonding curve | — |
| `getCreatorProfile` | All tokens by a creator + rug flags | `address`, `limit` |
| `getTokenHolders` | Top holders + concentration analysis | `mint`, `limit` |

## Architecture

```
AI Agent (SperaxOS)
    │
    ▼
Cloudflare Worker (MCP Streamable HTTP)
    │
    ├── pump.fun API (token data, search, trades)
    │   └── frontend-api-v3.pump.fun
    │
    └── Solana RPC (holder data, on-chain reads)
        └── api.mainnet-beta.solana.com
```

## Connecting

### Via SperaxOS MCP Marketplace
The server appears as "Pump.fun MCP" in the marketplace under crypto-web3 category.

### Manual URL
```
https://modelcontextprotocol.name/mcp/pump-fun-sdk
```

Or if using a custom subdomain:
```
https://pump-fun-sdk.modelcontextprotocol.name/mcp
```

## Key Concepts

### Bonding Curve
Every pump.fun token starts on a bonding curve — an AMM with virtual reserves that determine price. As people buy, the price increases along the curve. The curve has these key properties:

| Property | Description |
|----------|-------------|
| **Virtual SOL Reserves** | Initial virtual liquidity (typically ~30 SOL) |
| **Virtual Token Reserves** | Initial token supply in the curve (~1B tokens) |
| **Real SOL Reserves** | Actual SOL deposited by buyers |
| **Real Token Reserves** | Remaining tokens available on the curve |

### Graduation
When a token's real SOL reserves reach ~85 SOL (~$69K market cap), it **graduates** from the bonding curve:
1. Liquidity is permanently locked in a Raydium AMM pool
2. The bonding curve is closed
3. The token trades like a normal AMM token

### King of the Hill
The non-graduated token with the highest market cap. This is the most "hyped" token that hasn't graduated yet.

## Risk Warnings

The `getCreatorProfile` tool includes automatic rug-pull risk assessment:
- 🚩 **Red Flag**: Creator has 3+ tokens, zero graduated — possible serial rug-puller
- ✅ **Positive**: Creator has token(s) that graduated — completion track record

The `getTokenHolders` tool includes concentration analysis:
- 🚩 **High Concentration**: Top 5 holders control >50% of supply
- ✅ **Moderate Distribution**: More spread out holder base

## Safety Design

All 10 tools are **read-only**. The server intentionally excludes:
- Token creation (requires wallet signing + SOL)
- Buy/sell execution (requires wallet signing)
- Any operation that moves funds

Write operations must happen through the client-side wallet (e.g., via the swap-tool or tx-builder-tool builtin packages).

## Deployment

```bash
cd workers/pump-fun-mcp
npm install
npx wrangler deploy
```

Source: `workers/pump-fun-mcp/`
