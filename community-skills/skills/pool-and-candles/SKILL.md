---
name: pool-and-candles
description: Find a Solana token's most liquid pool and read its OHLCV candles, then describe the price action honestly - range, trend, volatility, volume - without predicting. Use when the user asks for a chart, candles, price history, "how has it moved", "where does it trade", "what pool", or wants support and resistance levels for a mint.
---

# Pool and candles

You turn raw pool and candle data for one Solana token into a short, factual read of what the price has done. You describe; you do not forecast. Every number you state comes from the data.

## Steps

1. **Get the mint address.** A name or ticker is not enough; ask for the address.
2. **Find the pool.** `GET https://three.ws/api/coin/pool?address=<mint>&network=solana` returns the most liquid pool address. The reverse lookup, pool to token, is `GET https://three.ws/api/coin/pair?address=<pool>&network=solana`. A token still on its bonding curve has no pool yet; read the curve instead with `GET https://three.ws/api/pump/curve?mint=<mint>` (or `get_bonding_curve` on the pump-fun MCP server) and say that it has not graduated.
3. **Pick an interval for the question.** Last few hours: `5m` or `15m`. Last day: `1H`. Last week: `4H`. Longer: `1D`. Valid intervals are 1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H, 6H, 8H, 12H, 1D, 3D, 1W, 1M.
4. **Fetch candles.** `GET https://three.ws/api/pump/price-history?mint=<mint>&interval=<interval>` returns `{ data: [{ t, o, h, l, c, v }], source, stale }`, where `t` is unix seconds. If `stale` is true, the feed fell back to its last good snapshot. Say so and give the time of the newest candle.
5. **Add context when useful.** `GET https://three.ws/api/crypto/token?address=<mint>` gives price, 24h change, market cap, liquidity and volume. `GET https://three.ws/api/pump/dex-trades?mint=<mint>&limit=40` lists the most recent swaps if the user wants to see who is trading right now.

The bundled script does steps 2 to 4 and the arithmetic:

```bash
node scripts/candles.mjs <mint> --interval 1H --bars 48
node scripts/candles.mjs <mint> --interval 15m --bars 96 --json
```

It prints the pool, window, open and close with percent change, high and low with the range, how far the close sits below the high, per-bar volatility, and whether volume is rising or fading (second half of the window against the first).

## How to read it

- **Trend:** compare open to close and where the close sits in the range. A close near the high after a wide range is strength; a close in the bottom third after a spike is a fade.
- **Volatility:** per-bar volatility above 5% on hourly bars means position sizes should be small. Say it in those words when it applies.
- **Volume:** price rising while volume fades is a weaker move than price rising on rising volume. Report both numbers; do not call a trend on price alone.
- **Levels:** call out the window's high and low and any price the candles touched two or more times. Do not invent levels the data does not show.
- **Liquidity:** under about $10k of pool depth, a candle can be one trade. Warn that the chart may not reflect a real market.

## Answer shape

One paragraph of plain reading, then the numbers:

> Over the last 24 hourly bars the price rose 6.5% but closed 4% under the day's high, and volume in the second half was 47% lower than in the first, so the move is losing participation.
> - Pool: `<pool address>`
> - Open to close: 0.000699 to 0.000744 (+6.5%)
> - Range: 0.000656 to 0.000775 (18%)
> - Volatility: 3.4% per hour
> - Data: live (not stale), last candle 05:00 UTC

## Rules

- Never predict a price or give a target. If asked "will it go up", describe the recent structure and say that nobody can tell them.
- State the interval and window with every number; a percent change without a window is meaningless.
- If price history is unavailable, say which request failed. Do not fill the gap from memory.
