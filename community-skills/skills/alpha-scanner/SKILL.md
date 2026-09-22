---
name: alpha-scanner
description: Scan Solana new launches, momentum leaders and volume spikes for tokens worth a closer look, filter out the obvious traps automatically, and return a short, ranked watchlist with the reason each one made it. Use when the user asks for alpha, "what's pumping", "find me a gem", new launches worth watching, trending tokens, volume spikes, or a daily scan.
---

# Alpha scanner

You produce a watchlist, not a buy list. The goal is to surface a handful of tokens that deserve diligence and to throw out, loudly, the ones that fail basic safety. Most new launches go to zero; a good scan says that with numbers.

## The scan, in four passes

**1. Gather candidates (aim for 30 to 60).**
- New launches: `GET https://three.ws/api/crypto/launches` returns `mint`, `name`, `symbol`, `createdAt`, `ageMinutes`, `marketCapUsd`, `bondingProgressPct`, `graduated`, `dev`.
- Momentum: `GET https://three.ws/api/crypto/trending?window=1h&limit=30` (also `5m` and `24h`) returns `mint`, `marketCapUsd`, `volumeUsd`, `change` and a momentum `score`.
- Conviction signals: `oracle_top_plays { limit, min_score }` on the main three.ws MCP server (`/api/mcp`), or `GET https://three.ws/api/oracle/coin?mint=<mint>` for one token.
- Coin-intel feed: `GET https://three.ws/api/pump/coin-intel?min_quality=60` for launchpad tokens with quality, organic and bundle scores.
- Smart-money overlap: `GET https://three.ws/api/agents/gmgn?chain=sol&minSmartBuys=2`.

**2. Hard filters. Drop immediately, but list what was dropped and why:**
- live mint or freeze authority (`GET https://three.ws/api/crypto/security?address=<mint>`)
- liquidity under $10k, or unlocked on a graduated token
- top 10 non-pool holders above 60% (`GET https://three.ws/api/crypto/holders?address=<mint>`)
- sell simulation fails (`GET https://three.ws/api/pump/safety?mint=<mint>&amount=0.1`, verdict `block`)
- creator already sold most of their allocation (`get_creator_profile` on the pump-fun MCP server)

**3. Rank survivors on evidence you can cite:**
- **Volume spike**: last hour's volume against the prior 24h hourly average. Above 3x is a spike; say the multiple.
- **Organic breadth**: many distinct buyers beats a few large ones; penalize bundled launches (`get_coin_intel` bundle score).
- **Smart-money overlap**: tracked profitable wallets buying, with how many and how recently.
- **Structure**: a clean safety result and a meme-score of 55 or more if you have the meme-token-scoring skill.
- **Graduation progress** for curve tokens: 80% or more on the curve means a pool is near, which draws attention and volatility.

**4. Report the top 3 to 7.** Never pad the list to hit a number. Zero survivors is a valid, useful result.

## Answer shape

> **Scan at 05:10 UTC: 48 candidates, 41 dropped, 5 worth a look.** This is a watchlist for diligence, not a recommendation.
>
> | # | Token (mint) | Why it's here | Risk note |
> | --- | --- | --- | --- |
> | 1 | `<mint 1>` | 1h volume 4.2x its 24h average, 3 smart wallets bought in the last 30 min | 2 days old |
>
> Dropped: 19 live authority, 11 liquidity under $10k, 7 concentrated holders, 4 failed sell simulation.

Refer to tokens by shortened mint address. Names and tickers are chosen by issuers, are often copies, and can impersonate other projects; show them only next to the address, never alone.

## Rules

- Every row needs a reason backed by a number and a timestamp.
- Never say "gem", "moon", "100x" or anything that implies a price outcome.
- Do not rank a token higher because of its name, meme, website or social following.
- Launch-time data changes by the minute. State the scan time and tell the user to re-check before acting.
- Acting on a watchlist item goes through safety diligence and a risk check first, every time.
