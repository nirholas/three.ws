---
name: market-data
title: "three.ws Market Data"
description: "Crypto and DeFi market data: coin tables, coin profiles, price history, sectors, exchanges, derivatives, TVL by protocol and chain, yield pools, stablecoin pegs, fees, DEX volume, exploit history, news pulse, and token signals."
use_case: "Use for crypto prices, market caps, price charts, trending coins, DeFi TVL, yield farming research, stablecoin depeg checks, protocol exploit due diligence, perp funding rates, token market signals, or a one-call market overview."
category: finance
service_url: https://three.ws
openapi:
  path: openapi.json
---

Pay-per-call crypto and DeFi market data from three.ws. Each endpoint is a
single GET that returns agent-ready JSON, priced in fractions of a cent. Data is
live from multiple upstream sources with failover; when an upstream is down the
call is refused before settlement, so you are never charged for an empty or
partial answer.

Start with `/api/x402/market-pulse` for broad context (global market, sentiment,
top coins, trending, TVL, stablecoin supply, DEX volume, and fees in one call),
then drill down with the narrow endpoints.

## Spend-aware usage

- Use `market-pulse` once instead of calling global, trending, defi, and
  stablecoin endpoints separately.
- Resolve a coin name to its id once with `market-coins?q=<name>` and reuse
  the id for `market-coin` and `market-chart`.
- Prefer the smallest `limit` that answers the question; most endpoints
  default to the full board.
- `token-intel` takes a contract address directly, so you can skip the id
  lookup for Solana tokens.
- Responses refresh every 1 to 10 minutes. Cache them instead of re-buying the
  same snapshot inside that window.
