---
name: four-meme-tool
description: Guide to the Four.meme BSC meme token launchpad tool — browse trending and new tokens, get buy/sell quotes, check bonding curve progress, view on-chain events, and inspect tax token mechanics. BSC-only with PancakeSwap graduation tracking.
license: MIT
metadata:
  category: trading
  difficulty: intermediate
  author: nich
  tags: [trading, four-meme, bsc, meme, launchpad]
---

# Four.meme Tool Guide

The Four.meme tool integrates with [four.meme](https://four.meme) — a BSC-only meme token launchpad. It provides real-time token data, rankings, buy/sell quotes, on-chain events, and tax token info.

## Tools (9)

| Tool | Description | Key Args |
|------|-------------|----------|
| `getConfig` | Platform config — raisedToken, contract addresses | — |
| `getTokenInfo` | On-chain token info — version, tokenManager, price, offers | `tokenAddress` |
| `tokenList` | Browse tokens with filters and pagination | `orderBy`, `pageIndex`, `pageSize`, `tokenName`, `symbol`, `labels`, `listedPancake` |
| `tokenGet` | Full token detail and trading info | `tokenAddress` |
| `tokenRankings` | Rankings: Hot, TradingDesc, Time, ProgressDesc, Graduated | `orderBy`, `barType` |
| `quoteBuy` | Estimate buy cost in BNB or tokens | `tokenAddress`, `amountWei`, `fundsWei` |
| `quoteSell` | Estimate sell proceeds | `tokenAddress`, `amountWei` |
| `getEvents` | On-chain events: create, purchase, sale, liquidity | `fromBlock`, `toBlock` |
| `getTaxInfo` | TaxToken fee allocation breakdown | `tokenAddress` |

## Rankings

| orderBy | Description |
|---------|-------------|
| `Hot` | Trending tokens |
| `TradingDesc` | Top 24h volume (use `barType: HOUR24`) |
| `Time` | Newest tokens |
| `ProgressDesc` | Highest bonding curve progress |
| `Graduated` | Tokens that completed bonding and listed on PancakeSwap |

## Token Labels

`Meme` · `AI` · `Defi` · `Games` · `Infra` · `De-Sci` · `Social` · `Depin` · `Charity` · `Others`

## Tax Token Info

When a token is a TaxToken, `getTaxInfo` returns fee split details:

| Field | Description |
|-------|-------------|
| `feeRate` | 1%, 3%, 5%, or 10% |
| `burnRate` | % of fee burned |
| `divideRate` | % of fee as dividends |
| `liquidityRate` | % of fee to liquidity |
| `recipientRate` | % of fee to recipient address |
| `minSharing` | Min token balance for dividend eligibility |

All rates sum to 100%: burnRate + divideRate + liquidityRate + recipientRate = 100%.

## Important Notes

- **BSC only** — Four.meme operates exclusively on BNB Smart Chain
- Only **TokenManager V2** tokens are supported for trading
- Buy/sell quotes are estimates — actual execution requires a wallet
- Token links: `https://four.meme/token/{address}`

## Architecture

```
AI Agent (SperaxOS)
    │
    ▼
Four.meme Builtin Tool
    │
    ├── four.meme REST API (token data, rankings, quotes)
    │   └── four.meme/meme-api/
    │
    └── BSC RPC (on-chain reads via Helper3 contract)
        └── BNB Smart Chain
```

## Related Skills

- `pancakeswap-tool` — DEX where graduated tokens list
- `erc8004-tool` — Four.meme supports ERC-8004 agent identity NFTs
- `pump-fun-mcp-guide` — Similar memecoin launchpad tool for Solana
