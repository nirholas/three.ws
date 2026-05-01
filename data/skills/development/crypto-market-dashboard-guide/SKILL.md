---
name: crypto-market-dashboard-guide
description: Guide to building a real-time crypto market dashboard with Next.js, React, and TradingView charts. Features multi-chain portfolio tracking, DeFi position monitoring, price alerts, and social sentiment integration. Production-ready dashboard template.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, crypto-market-dashboard-guide]
---

# Crypto Market Dashboard Guide

A production-ready crypto market dashboard template built with Next.js, React, and TradingView charts. Track portfolios, monitor DeFi positions, and visualize market data.

## Features

| Feature | Description |
|---------|-------------|
| **Live Prices** | Real-time token prices with WebSocket updates |
| **TradingView Charts** | Professional candlestick and line charts |
| **Portfolio Tracker** | Multi-chain wallet portfolio overview |
| **DeFi Positions** | LP, lending, staking position monitoring |
| **Price Alerts** | Configurable price notifications |
| **Watchlists** | Custom token watchlists |
| **Market Overview** | Top gainers, losers, trending tokens |
| **Social Sentiment** | X/Twitter sentiment indicators |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14+ (App Router) |
| UI | React 19, Ant Design, TailwindCSS |
| Charts | TradingView Lightweight Charts |
| Data | SWR, WebSocket, CoinGecko API |
| State | Zustand |
| Auth | Web3Auth + RainbowKit |

## Project Structure

```
crypto-market-dashboard/
├── src/
│   ├── app/
│   │   ├── dashboard/      # Main dashboard page
│   │   ├── portfolio/      # Portfolio tracker
│   │   ├── markets/        # Market overview
│   │   └── alerts/         # Price alerts
│   ├── components/
│   │   ├── charts/         # TradingView chart components
│   │   ├── portfolio/      # Portfolio widgets
│   │   ├── tokens/         # Token list, search, details
│   │   └── layout/         # Navigation, sidebar
│   ├── hooks/
│   │   ├── useTokenPrice.ts
│   │   ├── usePortfolio.ts
│   │   └── useWebSocket.ts
│   ├── store/
│   │   ├── portfolio.ts
│   │   ├── watchlist.ts
│   │   └── alerts.ts
│   └── services/
│       ├── market-data.ts
│       └── portfolio.ts
```

## Chart Component

```tsx
import { createChart, CandlestickSeries } from 'lightweight-charts';

function TokenChart({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { data } = useSWR(`/api/candles/${symbol}`);

  useEffect(() => {
    if (!containerRef.current || !data) return;
    
    const chart = createChart(containerRef.current, {
      width: 800,
      height: 400,
      layout: { background: { color: '#1a1a2e' }, textColor: '#e0e0e0' }
    });
    
    const series = chart.addSeries(CandlestickSeries);
    series.setData(data);
    
    return () => chart.remove();
  }, [data]);

  return <div ref={containerRef} />;
}
```

## Portfolio Widget

```tsx
function PortfolioSummary() {
  const { portfolio, totalValue, dailyChange } = usePortfolio();

  return (
    <Card>
      <Statistic title="Total Value" value={totalValue} prefix="$" />
      <Statistic
        title="24h Change"
        value={dailyChange}
        suffix="%"
        valueStyle={{ color: dailyChange >= 0 ? '#52c41a' : '#ff4d4f' }}
      />
      <TokenList tokens={portfolio} />
    </Card>
  );
}
```

## Market Overview

```tsx
function MarketOverview() {
  const { trending, gainers, losers } = useMarketData();

  return (
    <Tabs>
      <TabPane tab="Trending" key="trending">
        <TokenTable data={trending} />
      </TabPane>
      <TabPane tab="Top Gainers" key="gainers">
        <TokenTable data={gainers} sortBy="change24h" />
      </TabPane>
      <TabPane tab="Top Losers" key="losers">
        <TokenTable data={losers} sortBy="change24h" order="asc" />
      </TabPane>
    </Tabs>
  );
}
```

## Sperax Dashboard Widgets

Specialized widgets for Sperax ecosystem:

| Widget | Data |
|--------|------|
| **USDs Yield** | Current auto-yield APY |
| **SPA Price** | Live SPA price + chart |
| **veSPA Stats** | Total locked, APR |
| **Farm APYs** | Active farm pools + APYs |
| **Plutus Vaults** | Vault TVL and returns |

## Links

- GitHub: https://github.com/nirholas/crypto-market-dashboard
- TradingView Charts: https://www.tradingview.com/lightweight-charts/
- SperaxOS: https://app.sperax.io
