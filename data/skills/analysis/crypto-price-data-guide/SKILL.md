---
name: crypto-price-data-guide
description: How cryptocurrency prices work — the complete data pipeline from CEX order books and DEX pools through oracle networks to aggregators. Covers free API alternatives to CoinGecko, VWAP/TWAP calculations, and building price feeds without paid APIs. Use when explaining price sources, building market data features, or comparing data providers.
license: MIT
metadata:
  category: analysis
  difficulty: intermediate
  author: clawhub
  tags: [analysis, crypto-price-data-guide]
---

# Crypto Price Data Guide

Where do crypto prices actually come from? This guide breaks down the entire data pipeline — from raw exchange data to the numbers you see in apps.

## The Price Data Pipeline

```
┌──────────────────────────────────────────────────────────┐
│  LAYER 1: Primary Sources (where prices originate)       │
│                                                          │
│  CEX Order Books          DEX AMM Pools                  │
│  ┌──────────────┐        ┌──────────────┐                │
│  │ Binance      │        │ Uniswap V3   │                │
│  │ Coinbase     │        │ Curve        │                │
│  │ Kraken       │        │ Camelot      │                │
│  │ OKX, Bybit   │        │ Balancer     │                │
│  └──────┬───────┘        └──────┬───────┘                │
│         │                       │                        │
├─────────┼───────────────────────┼────────────────────────┤
│  LAYER 2: Oracle Networks (aggregate + post on-chain)    │
│         │                       │                        │
│         ▼                       ▼                        │
│  ┌──────────────────────────────────────┐                │
│  │ Chainlink     Pyth     Redstone      │                │
│  │ (median of multiple data sources)    │                │
│  └──────────────────┬───────────────────┘                │
│                     │                                    │
├─────────────────────┼────────────────────────────────────┤
│  LAYER 3: Aggregators (combine everything)               │
│                     ▼                                    │
│  ┌──────────────────────────────────────┐                │
│  │ CoinGecko  DeFi Llama  CoinMarketCap │                │
│  │ DexScreener  CoinCap   CoinPaprika   │                │
│  └──────────────────┬───────────────────┘                │
│                     │                                    │
├─────────────────────┼────────────────────────────────────┤
│  LAYER 4: Consumer Apps                                  │
│                     ▼                                    │
│  Portfolio trackers, trading bots, DeFi protocols,       │
│  AI agents (like SperaxOS), wallets                      │
└──────────────────────────────────────────────────────────┘
```

## Layer 1: Primary Price Sources

### Centralized Exchange (CEX) APIs

CEXes are the **dominant** price source for high-cap tokens. Their order books determine the "true" price through supply/demand matching.

| Exchange | Public API | Rate Limit | WebSocket |
|----------|-----------|-----------|-----------|
| **Binance** | `api.binance.com/api/v3/` | 1200 req/min | ✅ Real-time |
| **Coinbase** | `api.exchange.coinbase.com/` | 10 req/sec | ✅ Real-time |
| **Kraken** | `api.kraken.com/0/public/` | 1 req/sec | ✅ Real-time |
| **OKX** | `okx.com/api/v5/market/` | 20 req/2sec | ✅ Real-time |
| **Bybit** | `api.bybit.com/v5/market/` | 120 req/sec | ✅ Real-time |

**All of these are free, no API key required for public market data.**

#### Example: Binance Spot Price

```
GET https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT

Response: { "symbol": "BTCUSDT", "price": "64523.45000000" }
```

#### Example: Binance 24h Ticker

```
GET https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT

Response: {
  "symbol": "ETHUSDT",
  "priceChange": "45.20",
  "priceChangePercent": "1.42",
  "lastPrice": "3245.67",
  "volume": "584231.45",
  "highPrice": "3289.00",
  "lowPrice": "3178.23"
}
```

### DEX On-Chain Data

For tokens that aren't listed on CEXes (the **long tail**), DEX pools are the only price source.

| Source | Chains | How Price Is Determined |
|--------|--------|----------------------|
| **Uniswap V2** | ETH, Arbitrum, etc. | Constant product: price = reserveB / reserveA |
| **Uniswap V3** | ETH, Arbitrum, etc. | Square root price from pool slot0: sqrtPriceX96 |
| **Curve** | ETH, Arbitrum, etc. | StableSwap invariant (optimized for pegged assets) |
| **Camelot** | Arbitrum | V2 + V3 pools (Arbitrum-native) |

**Reading DEX prices**:
1. **Direct RPC** — Call pool contracts to read reserves/sqrtPrice
2. **The Graph** — Query indexed swap events via GraphQL
3. **DexScreener API** — Aggregated DEX data across 80+ chains

#### DexScreener Example

```
GET https://api.dexscreener.com/latest/dex/tokens/0xD74f5255D557944cf7Dd0E45FF521520002D5748

Returns: SPA pair data across all DEXes
```

### How CEX and DEX Prices Stay in Sync

**Arbitrage bots**. If ETH is $3,200 on Binance but $3,210 on Uniswap:
1. Bot buys on Binance (cheaper)
2. Bot sells on Uniswap (expensive)
3. Price difference narrows until it's less than gas + bridge costs

This is why prices across venues are usually within 0.1–0.5% of each other.

## Layer 2: Oracle Networks

Oracles aggregate CEX + DEX data and make it available **on-chain** for smart contracts.

### Chainlink

The dominant oracle network. ~1000+ price feeds across EVM chains.

**How it works**:
1. Multiple independent oracle nodes fetch prices from CEXes and DEXes
2. Each node submits its observation to the aggregator contract
3. The contract takes the **median** of all observations
4. Updates when: deviation > threshold (typically 0.5–1%) OR heartbeat time passes

**Reading a Chainlink feed on-chain**:

```
// ETH/USD on Ethereum: 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419
// SPA/USD on Arbitrum: Available via Chainlink

function getPrice() {
    (, int256 price,,,) = priceFeed.latestRoundData();
    return uint256(price); // 8 decimals
}
```

**Key feeds**:

| Feed | Address (Ethereum) | Decimals |
|------|-------------------|----------|
| ETH/USD | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | 8 |
| BTC/USD | `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c` | 8 |
| USDC/USD | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` | 8 |

> **Sperax Context**: USDs uses Chainlink price feeds via its MasterPriceOracle to value collateral (USDC, USDT) and maintain its peg.

### Pyth Network

**Pull oracle** — prices update sub-second but consumers must "pull" the latest update on-chain.

```
GET https://hermes.pyth.network/api/latest_price_feeds?ids[]=0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace

Returns: { price: "6452345000000", expo: -8, conf: "2500000" }
```

### Chainlink vs Pyth

| Feature | Chainlink | Pyth |
|---------|-----------|------|
| Model | Push (auto-updates) | Pull (consumer requests) |
| Latency | 1–60 min heartbeat | ~400ms |
| Cost | Gas paid by oracle network | Gas paid by consumer |
| Coverage | 1000+ feeds | 500+ feeds |
| Security | Battle-tested (5+ years) | Newer but growing fast |

## Layer 3: Free Aggregator APIs

These combine CEX + DEX + oracle data into convenient APIs.

### DeFi Llama (Best Free Option)

**Zero rate limiting. Zero API key. Most generous free API in crypto.**

| Endpoint | What It Returns |
|----------|----------------|
| `coins.llama.fi/prices/current/{coins}` | Current prices for any token |
| `api.llama.fi/protocols` | All tracked protocols with TVL |
| `yields.llama.fi/pools` | All yield pools across DeFi |
| `stablecoins.llama.fi/stablecoins` | All stablecoin market data |

**Price query example**:
```
GET https://coins.llama.fi/prices/current/arbitrum:0xD74f5255D557944cf7Dd0E45FF521520002D5748

Returns: USDs price from on-chain sources
```

### CoinCap

Simple, clean API for top 2000 coins.

```
GET https://api.coincap.io/v2/assets?limit=10

Returns: Top 10 coins by market cap with price, volume, change
```

### CoinPaprika

Decent free tier with ATH data and social links.

```
GET https://api.coinpaprika.com/v1/tickers/btc-bitcoin

Returns: Price, ATH, ATH date, volume, market cap, beta, supply
```

### CryptoCompare

Good for OHLCV (candlestick) data.

```
GET https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=30

Returns: 30 days of daily OHLCV data
```

## Building Without CoinGecko

A practical multi-source approach:

| Data Need | Primary Source | Fallback |
|-----------|---------------|----------|
| Top coin prices | Binance API | CoinCap |
| Long-tail tokens | DexScreener | DeFi Llama |
| Historical OHLCV | CryptoCompare | Binance klines |
| TVL / protocol data | DeFi Llama | — (only source) |
| Yield / APY data | DeFi Llama yields | — |
| On-chain accurate price | Chainlink feeds | Pyth |
| Token metadata | CoinPaprika | Token Lists |
| Market sentiment | Fear & Greed API | — |

**Waterfall strategy** (what production apps use):
```
1. Try Binance (fastest, most liquid)
2. Fall back to CoinCap (broader coverage)
3. Fall back to DexScreener (on-chain tokens)
4. Fall back to DeFi Llama (universal)
```

> **SperaxOS** uses a similar multi-provider waterfall: Binance → CoinCap → DexScreener → CoinGecko for maximum reliability.

## Price Calculation Methods

### VWAP (Volume-Weighted Average Price)

How aggregators compute a single price from multiple exchanges:

```
VWAP = Σ(Price_i × Volume_i) / Σ(Volume_i)
```

Example:
| Exchange | Price | 24h Volume |
|----------|-------|-----------|
| Binance | $3,200 | $2B |
| Coinbase | $3,205 | $500M |
| Kraken | $3,198 | $100M |

```
VWAP = (3200×2B + 3205×500M + 3198×100M) / (2B + 500M + 100M)
     = $3,200.96
```

### TWAP (Time-Weighted Average Price)

Used by Uniswap V3 oracle and some protocols:

```
TWAP = Average price over a time window (e.g., last 30 minutes)
```

More resistant to manipulation than spot price.

## Agent Tips

1. **Never rely on a single source** — always implement fallbacks
2. **CEX data is freshest** for major tokens — use Binance/Coinbase first
3. **DEX data is essential** for tokens not listed on CEXes
4. **DeFi Llama is the best free API** — zero rate limiting, comprehensive
5. **Chainlink feeds are the gold standard** for on-chain price verification
6. **Always show the data source** — users should know where prices come from

## Links

- DeFi Llama API: https://defillama.com/docs/api
- Binance API: https://binance-docs.github.io/apidocs/
- Chainlink Feeds: https://data.chain.link
- DexScreener: https://docs.dexscreener.com
- CoinCap: https://docs.coincap.io
- Pyth Network: https://pyth.network
- Sperax (uses Chainlink for USDs pricing): https://app.sperax.io
