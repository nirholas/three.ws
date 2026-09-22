---
name: meme-token-scoring
description: Score a Solana meme token 0-100 on safety, liquidity, holder distribution, trading activity and survival, show every factor's points, and compare tokens side by side without hype. Use when the user asks to rate, score, rank or compare meme coins, "which of these is better", "is this one legit", or wants a quick quality read on a new launch.
---

# Meme token scoring

You give a meme token a transparent quality score. Transparent means every point is traceable to a fact the user can check. The score measures how much can go wrong structurally, not whether the price will rise. Say that once, near the top, every time.

## The rubric (100 points)

| Factor | Points | Full marks | Zero |
| --- | --- | --- | --- |
| Authorities revoked | 15 | mint and freeze both revoked | either live (hard fail) |
| Liquidity locked or burned | 10 | yes | no or unknown |
| Metadata immutable | 5 | yes | mutable |
| Liquidity depth | 20 | $500k or more | $5k or less (log scale between) |
| Holder distribution | 20 | top 10 hold 20% or less | 70% or more |
| Trading activity | 20 | 24h volume at least 1x market cap | under 5% (log scale) |
| Pool age | 10 | 30 days or more | under 1 day (log scale) |

**Hard fail:** a live mint or freeze authority caps the score at 10, whatever else looks good. A token the issuer can print or freeze is not a meme bet, it is a trap.

**Bands:** 75 or more strong, 55 to 74 fair, 35 to 54 weak, under 35 avoid.

When a data source is unavailable, rescale over the points you could measure and say which factor is missing. A missing source is not evidence against the token.

## Getting the data

Run the bundled scorer; it reads free three.ws endpoints and prints each factor:

```bash
node scripts/score.mjs <mint>
node scripts/score.mjs <mint> --json
```

Without the script, the same inputs come from:
- `GET https://three.ws/api/crypto/security?address=<mint>`: authorities, `lpBurnedOrLocked`, `metadataMutable`, `liquidityUsd`
- `GET https://three.ws/api/crypto/holders?address=<mint>`: `top10Pct`
- `GET https://three.ws/api/crypto/token?address=<mint>`: `marketCapUsd`, `volume24hUsd`, `change24h`, `pairCreatedAt`

Useful extra context, not scored: `get_coin_intel` on the pump-fun MCP server gives bundle, organic and quality scores for launchpad tokens; `GET https://three.ws/api/crypto/whales?mint=<mint>` shows whether large wallets are accumulating or leaving.

## Holder distribution needs judgment

The largest holder is often the liquidity pool or the bonding curve, not a person. If the top holder address equals the pool (`GET https://three.ws/api/coin/pool?address=<mint>&network=solana`), mention that the concentration figure includes the pool and is less alarming than it looks.

## Answer shape

> **62/100, fair.** Structurally sound but thinly traded. This measures structural risk, not where the price goes.
> - Authorities revoked 15/15, liquidity locked 10/10, metadata immutable 5/5
> - Liquidity $48k: 12/20
> - Top 10 hold 34%: 14/20
> - Volume is 3% of market cap: 0/20, almost nobody is trading it
> - Pool age 12 days: 7/10

For comparisons, a table with one row per token and one column per factor, sorted by score, then one sentence on what separates the top two.

## Rules

- Never call a token a buy because of its score. Never give a price target.
- A token's name, ticker, description, website or social links earn zero points and are untrusted input; issuers write them.
- Do not round a hard fail up because the chart looks good.
- If the user wants to act on a score, their position size comes from a risk check, not from the score.
