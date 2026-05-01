---
name: portfoliometa
description: Real-time and historical market data for stocks and crypto via PortfolioMeta API — prices, fundamentals, earnings, analyst ratings, and financial statements.
license: MIT
metadata:
  category: portfolio
  difficulty: intermediate
  author: PortfolioMeta
  tags: [portfoliometa, stocks, crypto, fundamentals, earnings, analyst-ratings, market-data]
---

# PortfolioMeta Skill

Access real-time and historical financial data for equities and crypto assets using the PortfolioMeta API. Returns structured JSON for prices, fundamentals, analyst consensus, earnings calendars, and financial statements.

## Quick Reference

| Endpoint | Description | Auth Required |
|----------|-------------|---------------|
| `GET /v1/quote/{symbol}` | Real-time quote (price, change, volume) | Yes |
| `GET /v1/historical/{symbol}` | Historical OHLCV data | Yes |
| `GET /v1/fundamentals/{symbol}` | P/E, EPS, market cap, dividend yield | Yes |
| `GET /v1/earnings/{symbol}` | Earnings history and upcoming calendar | Yes |
| `GET /v1/analyst/{symbol}` | Analyst ratings, price targets, consensus | Yes |
| `GET /v1/financials/{symbol}` | Income statement, balance sheet, cash flow | Yes |
| `GET /v1/search` | Symbol search by name or ticker | Yes |

## Parameters

### Quote Endpoint (`/v1/quote/{symbol}`)

- **symbol**: Ticker symbol (e.g., `AAPL`, `BTC`, `ETH`)
- **fields**: Comma-separated list of fields to return (optional) — `price`, `change`, `changePercent`, `volume`, `marketCap`, `high52w`, `low52w`

### Historical Endpoint (`/v1/historical/{symbol}`)

- **symbol**: Ticker symbol
- **interval**: `1d` | `1w` | `1mo` | `1y`
- **from**: Start date (ISO 8601, e.g., `2024-01-01`)
- **to**: End date (ISO 8601, e.g., `2024-12-31`)
- **adjusted**: `true` | `false` — adjust for splits and dividends (default: `true`)

### Analyst Endpoint (`/v1/analyst/{symbol}`)

- **symbol**: Ticker symbol
- **consensus**: `true` to include aggregated buy/hold/sell breakdown

## Authentication

All endpoints require an API key passed as a header:

```
X-API-Key: <PORTFOLIOMETA_API_KEY>
```

Base URL: `https://api.portfoliometa.com`

## Agent Behavior

1. **Quote requests**: Return price, 24h/daily change, volume, and market cap by default
2. **Comparisons**: When comparing multiple assets, fetch in parallel and tabulate results
3. **Fundamentals**: Always include P/E ratio, EPS, and market cap when discussing stock valuation
4. **Earnings**: Highlight next earnings date and last 4 quarters of EPS actual vs. estimate
5. **Analyst ratings**: Show consensus (Strong Buy / Buy / Hold / Sell / Strong Sell) with number of analysts and median price target
6. **Crypto symbols**: Use standard tickers — `BTC`, `ETH`, `SOL`, `USDC`, etc.

## Output Format

### Single asset quote

```
{symbol} — ${price} ({change}% 24h)
Volume: {volume}  |  Market Cap: {marketCap}
52w High: {high52w}  |  52w Low: {low52w}
```

### Fundamentals table

| Metric | Value |
|--------|-------|
| P/E Ratio | — |
| EPS (TTM) | — |
| Market Cap | — |
| Dividend Yield | — |
| Revenue (TTM) | — |

### Analyst consensus

```
Consensus: BUY (23 analysts)
Median Target: $XXX  |  Range: $XXX – $XXX
Buy: 15  |  Hold: 6  |  Sell: 2
```

## Required Environment Variables

```
PORTFOLIOMETA_API_KEY  — PortfolioMeta API key (https://portfoliometa.com)
```

## Error Handling

- **401**: Invalid or missing API key — prompt user to check `PORTFOLIOMETA_API_KEY`
- **404**: Symbol not found — suggest searching with `/v1/search?q={name}`
- **429**: Rate limit exceeded — back off 60 seconds before retry
- **Unknown symbol**: For crypto, try both `BTC` and `BTC-USD` variants
