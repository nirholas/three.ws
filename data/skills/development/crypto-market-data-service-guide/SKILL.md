---
name: crypto-market-data-service-guide
description: Guide to the Crypto Market Data TypeScript service — clean market data APIs for token prices, candles, market cap, and volume across multiple chains. Features caching, rate limiting, fallback sources, and WebSocket subscriptions. Built for production DeFi applications.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, crypto-market-data-service-guide]
---

# Crypto Market Data Service Guide

A production-ready TypeScript service for crypto market data. Features caching, rate limiting, fallback sources, and WebSocket subscriptions.

## Architecture

```
Client Request
    │
    ▼
Rate Limiter → Cache Check
    │              │
    │          Cache Hit? → Return cached
    │              │
    │          Cache Miss
    │              │
    ▼              ▼
Primary Source (CoinGecko)
    │
    ├── Success → Cache → Return
    │
    └── Failure → Fallback Source
                    │
                    ├── CoinMarketCap
                    ├── DeFi Llama
                    └── DexScreener
```

## Quick Start

```typescript
import { MarketDataService } from '@nirholas/crypto-market-data';

const service = new MarketDataService({
  primarySource: 'coingecko',
  fallbackSources: ['coinmarketcap', 'defillama'],
  cache: { ttl: 60_000 },  // 1 minute cache
  rateLimit: { maxRequests: 30, windowMs: 60_000 }
});
```

## Price Data

```typescript
// Get current price
const price = await service.getPrice('SPA', 'usd');
// { price: 0.0123, change24h: 5.2, volume24h: 1234567 }

// Get multiple prices
const prices = await service.getPrices(['SPA', 'ETH', 'BTC'], 'usd');

// Get price with metadata
const detailed = await service.getDetailedPrice('SPA');
// { price, marketCap, volume24h, circulatingSupply, ath, athDate, ... }
```

## Candle Data (OHLCV)

```typescript
// Get 1-hour candles
const candles = await service.getCandles('SPA', {
  interval: '1h',
  limit: 100
});
// [{ time, open, high, low, close, volume }, ...]

// Get daily candles with date range
const daily = await service.getCandles('SPA', {
  interval: '1d',
  from: '2024-01-01',
  to: '2024-12-31'
});
```

## WebSocket Subscriptions

```typescript
// Subscribe to real-time price updates
service.subscribePrices(['SPA', 'ETH'], (update) => {
  console.log(`${update.symbol}: $${update.price}`);
});

// Subscribe to trade events
service.subscribeTrades('SPA', (trade) => {
  console.log(`${trade.side} ${trade.amount} @ ${trade.price}`);
});
```

## Caching

```typescript
const service = new MarketDataService({
  cache: {
    ttl: 60_000,          // Default: 1 minute
    maxSize: 10_000,      // Max cached entries
    strategy: 'lru',      // LRU eviction
    persistence: 'redis', // Optional: Redis backend
    redisUrl: process.env.REDIS_URL
  }
});
```

## Rate Limiting

```typescript
const service = new MarketDataService({
  rateLimit: {
    maxRequests: 30,
    windowMs: 60_000,
    strategy: 'sliding-window',
    queueExcess: true  // Queue instead of reject
  }
});
```

## Fallback Chain

```typescript
const service = new MarketDataService({
  primarySource: 'coingecko',
  fallbackSources: ['coinmarketcap', 'defillama', 'dexscreener'],
  fallbackStrategy: 'sequential',  // Try each in order
  // OR
  fallbackStrategy: 'race',  // Use fastest response
});
```

## Token Lists

```typescript
// Search tokens
const results = await service.searchTokens('sperax');
// [{ symbol: 'SPA', name: 'Sperax', chain: 'arbitrum', address: '0x...' }]

// Get trending tokens
const trending = await service.getTrending();

// Get token by address
const token = await service.getTokenByAddress('0x...', 'arbitrum');
```

## SperaxOS Integration

This service powers the market data layer in SperaxOS:
- Portfolio value calculations
- Price charts in chat
- CoinGecko tool backend
- Price alerts engine

## Links

- GitHub: https://github.com/nirholas/crypto-market-data-ts
- npm: https://www.npmjs.com/package/@nirholas/crypto-market-data
- Sperax: https://app.sperax.io
