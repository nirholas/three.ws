---
name: crypto-data-aggregation-guide
description: Guide to CryptoDataPy — a Python library that aggregates crypto data from 20+ sources into a single unified interface. Covers price data, on-chain metrics, social data, derivatives, and macro indicators. One API for CoinGecko, Glassnode, DeFi Llama, and more.
license: MIT
metadata:
  category: analysis
  difficulty: intermediate
  author: nich
  tags: [analysis, crypto-data-aggregation-guide]
---

# CryptoDataPy — Crypto Data Aggregation Guide

CryptoDataPy is a Python library that unifies 20+ crypto data sources into a single interface. One import, one API call — get prices, on-chain metrics, social data, derivatives, and macro indicators.

## Supported Sources

| Source | Data Type | API Key Required |
|--------|-----------|-----------------|
| CoinGecko | Prices, market cap, volume | Free tier available |
| DeFi Llama | TVL, yields, stablecoin data | No |
| Glassnode | On-chain metrics | Yes |
| CryptoCompare | OHLCV, social stats | Free tier available |
| Messari | Asset profiles, metrics | Free tier available |
| Dune Analytics | Custom SQL queries | Yes |
| Etherscan | Gas, transactions | Free tier available |
| Alternative.me | Fear & Greed Index | No |
| DexScreener | DEX prices, pools | No |
| Binance | OHLCV, order book | No |
| And 10+ more | Various | Various |

## Quick Start

```bash
pip install cryptodatapy
```

```python
from cryptodatapy import DataRequest

# Get Bitcoin daily prices from multiple sources
dr = DataRequest(
    tickers=['BTC', 'ETH', 'SPA'],
    fields=['close', 'volume', 'market_cap'],
    freq='daily',
    start_date='2024-01-01'
)

data = dr.fetch()
print(data.head())
```

## Data Types

### Price Data
```python
# OHLCV data
dr = DataRequest(
    tickers=['SPA', 'ETH'],
    fields=['open', 'high', 'low', 'close', 'volume'],
    freq='1h',
    source='binance'
)
```

### On-Chain Metrics
```python
# Active addresses, transaction count, hash rate
dr = DataRequest(
    tickers=['ETH'],
    fields=['active_addresses', 'tx_count', 'hash_rate'],
    freq='daily',
    source='glassnode'
)
```

### DeFi Metrics
```python
# TVL, yields, protocol revenue
dr = DataRequest(
    tickers=['sperax', 'aave', 'uniswap'],
    fields=['tvl', 'revenue', 'fees'],
    freq='daily',
    source='defillama'
)
```

### Social Data
```python
# Social volume, sentiment, developer activity
dr = DataRequest(
    tickers=['SPA', 'BTC'],
    fields=['social_volume', 'dev_activity', 'github_stars'],
    freq='daily',
    source='santiment'
)
```

### Derivatives
```python
# Open interest, funding rates, liquidations
dr = DataRequest(
    tickers=['BTC', 'ETH'],
    fields=['open_interest', 'funding_rate', 'liquidations'],
    freq='1h',
    source='coinglass'
)
```

## Multi-Source Aggregation

```python
# Fetch from multiple sources and merge
dr = DataRequest(
    tickers=['SPA'],
    fields=['close', 'volume', 'tvl', 'social_volume'],
    sources=['coingecko', 'defillama', 'santiment'],
    freq='daily',
    agg_method='first_valid'  # Use first non-null value
)
```

## Output Formats

```python
# Pandas DataFrame (default)
df = dr.fetch()

# JSON
json_data = dr.fetch(format='json')

# CSV export
dr.fetch().to_csv('crypto_data.csv')

# Parquet (efficient storage)
dr.fetch().to_parquet('crypto_data.parquet')
```

## Use Cases

### Portfolio Tracking
```python
portfolio = ['SPA', 'ETH', 'BTC', 'USDC']
dr = DataRequest(
    tickers=portfolio,
    fields=['close', 'market_cap', 'volume'],
    freq='daily',
    start_date='2024-01-01'
)
data = dr.fetch()
returns = data['close'].pct_change()
```

### Sperax Analytics
```python
# Track USDs supply and SPA metrics
dr = DataRequest(
    tickers=['SPA'],
    fields=['close', 'volume', 'market_cap', 'tvl'],
    sources=['coingecko', 'defillama'],
    freq='daily'
)
```

### Backtesting Data
```python
# Get clean historical data for backtesting
dr = DataRequest(
    tickers=['ETH', 'BTC'],
    fields=['open', 'high', 'low', 'close', 'volume'],
    freq='1h',
    start_date='2023-01-01',
    end_date='2024-12-31',
    source='binance',
    fill_method='ffill'  # Forward fill gaps
)
```

## Links

- GitHub: https://github.com/nirholas/CryptoDataPy
- PyPI: https://pypi.org/project/cryptodatapy/
- Sperax: https://app.sperax.io
