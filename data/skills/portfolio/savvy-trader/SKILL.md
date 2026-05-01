---
name: savvy-trader
description: Daily OHLCV summaries and real-time quotes for stocks and crypto via Savvy Trader AI — open, close, high, low, volume, and multi-asset comparison.
license: MIT
metadata:
  category: portfolio
  difficulty: beginner
  author: Savvy Trader AI
  tags: [savvy-trader, stocks, crypto, ohlcv, quotes, market-data, price-history]
---

# Savvy Trader AI Skill

Retrieve daily OHLCV (Open, High, Low, Close, Volume) price data and real-time quotes for stocks and crypto assets via the Savvy Trader AI plugin API. Designed for straightforward price lookups and multi-asset daily summaries.

## Quick Reference

| Function | Description | Auth Required |
|----------|-------------|---------------|
| `getSummaries` | Daily OHLCV summary for one or more symbols | No |
| `getQuotes` | Real-time quote with price and change data | No |

## Function Specifications

### `getSummaries`

Returns daily OHLCV data for the requested symbols and date range.

**Parameters**:
- **symbols** _(required)_: Array of ticker symbols — e.g., `["AAPL", "BTC", "ETH"]`
- **date** _(optional)_: ISO date string for a specific trading day — e.g., `"2024-12-31"`. Defaults to the most recent trading day.
- **range** _(optional)_: Number of days of history to return — e.g., `7`, `30`, `90`

**Response fields per symbol**:
```json
{
  "symbol": "AAPL",
  "date": "2024-12-31",
  "open": 185.20,
  "high": 188.44,
  "low": 184.60,
  "close": 187.15,
  "volume": 52340000,
  "changePercent": 1.05
}
```

### `getQuotes`

Returns the current price and change metrics for one or more symbols.

**Parameters**:
- **symbols** _(required)_: Array of ticker symbols

**Response fields per symbol**:
```json
{
  "symbol": "BTC",
  "price": 67420.50,
  "change": 1240.00,
  "changePercent": 1.87,
  "volume": 28500000000,
  "timestamp": "2024-12-31T18:30:00Z"
}
```

## Supported Asset Classes

- **US Equities**: NYSE and NASDAQ-listed stocks (e.g., `AAPL`, `TSLA`, `NVDA`)
- **ETFs**: Major ETFs (e.g., `SPY`, `QQQ`, `GLD`)
- **Crypto**: Top assets by market cap (e.g., `BTC`, `ETH`, `SOL`, `AVAX`, `MATIC`)

## Agent Behavior

1. **Default to `getQuotes`** for "what's the price of X" questions
2. **Use `getSummaries`** for trend analysis, charting context, or "how did X do this week"
3. **Batch symbols** in a single call when comparing multiple assets — do not make sequential calls
4. **Present prices clearly**: Always show symbol, price, and 24h/daily change together
5. **Crypto vs equities**: Crypto trades 24/7; note that equity quotes reflect market hours

## Output Format

### Price quote (single asset)

```
{symbol}: ${price} ({changePercent:+.2f}% today)
Volume: {volume}
```

### Multi-asset comparison table

| Symbol | Price | Today | Volume |
|--------|-------|-------|--------|
| BTC | $67,420 | +1.87% | $28.5B |
| ETH | $3,512 | +0.94% | $14.2B |
| SOL | $178 | +3.21% | $3.8B |

### OHLCV summary

```
{symbol} — {date}
Open: ${open}  |  Close: ${close}
High: ${high}  |  Low: ${low}
Volume: {volume}  |  Change: {changePercent:+.2f}%
```

## Notes

- No API key required — Savvy Trader AI provides public endpoints via the LobeChat plugin manifest
- Rate limit: ~60 requests/minute per IP; batch symbols to stay within limits
- Historical data availability varies by asset — most equities have 20+ years, crypto varies
- Prices are delayed ~15 minutes for equities during market hours; crypto is real-time
