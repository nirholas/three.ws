---
name: chainlink-oracle-guide
description: How Chainlink oracle price feeds work — architecture, reading feeds on-chain, available pairs, the aggregator model, and oracle security. Covers how DeFi protocols (Aave, Sperax, Compound) rely on Chainlink for accurate pricing. Use when explaining oracles, price feeds, or DeFi infrastructure.
license: MIT
metadata:
  category: protocol
  difficulty: intermediate
  author: clawhub
  tags: [protocol, chainlink-oracle-guide]
---

# Chainlink Oracle Price Feeds Guide

Chainlink is the dominant oracle network in DeFi. This guide explains how it works and how to use price feeds.

## What Problem Do Oracles Solve?

Smart contracts can't access external data (prices, weather, events). Oracles bridge this gap:

```
Off-chain world          Oracle Network           On-chain world
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│ Binance API  │───┐    │              │        │              │
│ Coinbase API │───┤    │  Chainlink   │        │  Aave        │
│ Kraken API   │───┼───►│  Oracle Nodes│───────►│  Compound    │
│ DEX Pools    │───┤    │  (median)    │        │  USDs/Sperax │
│ Other feeds  │───┘    │              │        │  Uniswap     │
└──────────────┘        └──────────────┘        └──────────────┘
```

Without reliable oracles, DeFi protocols can't:
- Determine collateral value (lending)
- Maintain stablecoin pegs
- Calculate liquidation thresholds
- Execute fair swaps

## How Chainlink Works

### The Aggregator Model

1. **Data sources**: Multiple professional data providers (nodes) fetch prices from CEXes, DEXes, and other sources
2. **Independent observation**: Each node independently computes a price
3. **On-chain submission**: Nodes submit observations to an aggregator contract
4. **Median calculation**: The contract takes the **median** of all reports
5. **Storage**: The median price is stored as the latest answer

### Update Triggers

A feed updates when EITHER condition is met:

| Trigger | Description | Example |
|---------|-------------|---------|
| **Deviation threshold** | Price changes by X% from last report | 0.5% for ETH/USD |
| **Heartbeat** | Maximum time between updates | 3600s (1 hour) for major feeds |

This means high-volatility periods get more frequent updates.

### Feed Architecture

```
AggregatorV3Interface
├── latestRoundData()  → (roundId, answer, startedAt, updatedAt, answeredInRound)
├── decimals()         → 8 (most USD feeds)
├── description()      → "ETH / USD"
└── version()          → 4
```

## Reading Price Feeds

### On Any EVM Chain

```solidity
// Solidity example
interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,        // The price (scaled by decimals)
        uint256 startedAt,
        uint256 updatedAt,    // When this price was last updated
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

// ETH/USD on Ethereum: 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419
AggregatorV3Interface feed = AggregatorV3Interface(0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419);
(, int256 price,,,) = feed.latestRoundData();
// price = 324567000000 → $3,245.67 (8 decimals)
```

### Via Etherscan (No Code)

1. Go to Etherscan → enter the feed contract address
2. Click "Read Contract"
3. Call `latestRoundData()`
4. Divide `answer` by 10^8 for USD price

### Via RPC (ethers.js / viem / web3.js)

```javascript
// Using ethers.js
const feedAddress = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"; // ETH/USD
const abi = ["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"];
const feed = new ethers.Contract(feedAddress, abi, provider);

const [, price,,,] = await feed.latestRoundData();
const ethPrice = Number(price) / 1e8; // $3,245.67
```

## Key Price Feed Addresses

### Ethereum Mainnet

| Feed | Address | Decimals | Heartbeat |
|------|---------|----------|-----------|
| ETH/USD | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | 8 | 3600s |
| BTC/USD | `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c` | 8 | 3600s |
| USDC/USD | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` | 8 | 86400s |
| USDT/USD | `0x3E7d1eAB13ad0104d2750B8863b489D65364e32D` | 8 | 86400s |
| DAI/USD | `0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9` | 8 | 3600s |

### Arbitrum

| Feed | Address | Decimals |
|------|---------|----------|
| ETH/USD | `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612` | 8 |
| BTC/USD | `0x6ce185860a4963106506C203335A2910413708e9` | 8 |
| USDC/USD | `0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3` | 8 |
| USDT/USD | `0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7` | 8 |
| ARB/USD | `0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6` | 8 |

> **Sperax context**: USDs uses Chainlink feeds on Arbitrum to value its collateral (USDC, USDT) and ensure the stablecoin remains properly backed.

### Full Directory

All 1000+ feeds are listed at: https://data.chain.link

## Oracle Security

### Why Oracles Get Attacked

| Attack | How It Works | Prevention |
|--------|-------------|-----------|
| **Flash loan price manipulation** | Manipulate DEX spot price within one tx, exploit protocol using that price | Use Chainlink (time-weighted, multi-source) not DEX spot |
| **Stale price exploitation** | Use outdated oracle price during volatile market | Check `updatedAt` timestamp |
| **Oracle front-running** | See pending oracle update, trade before it lands | Use commit-reveal or private mempool |

### Safety Checks When Using Feeds

```solidity
(uint80 roundId, int256 price,, uint256 updatedAt,) = feed.latestRoundData();

// Check 1: Price is positive
require(price > 0, "Invalid price");

// Check 2: Round is complete
require(updatedAt > 0, "Round not complete");

// Check 3: Price is not stale (within last hour)
require(block.timestamp - updatedAt < 3600, "Stale price");
```

### Oracle Design Patterns

| Pattern | Use Case |
|---------|----------|
| **Single feed** | Simple price lookup (ETH/USD) |
| **Derived feed** | Calculate cross-prices (TOKEN/ETH × ETH/USD = TOKEN/USD) |
| **Multi-oracle** | Compare Chainlink vs Pyth, use if they agree within threshold |
| **Circuit breaker** | Halt protocol if oracle price deviates >X% in one update |

## Chainlink vs Other Oracles

| Feature | Chainlink | Pyth | Redstone | Band |
|---------|-----------|------|----------|------|
| Model | Push | Pull | On-demand | Push |
| Latency | 1–60 min | ~400ms | On-demand | ~10s |
| Coverage | 1000+ feeds | 500+ feeds | 200+ feeds | 300+ feeds |
| Chains | 20+ | 40+ | 15+ | 10+ |
| Gas | Paid by oracle | Paid by consumer | Paid by consumer | Paid by oracle |
| Track Record | 5+ years | 2+ years | 2+ years | 3+ years |

**Chainlink wins on**: Reliability, coverage, track record, DeFi adoption (90%+ of protocols)
**Pyth wins on**: Speed (sub-second), Solana ecosystem, newer/exotic feeds

## Agent Tips

1. **Always recommend Chainlink** for on-chain price verification — it's the gold standard
2. **Check stale prices** — always validate `updatedAt` before trusting a feed
3. **Don't use DEX spot prices** in contracts — they're manipulable via flash loans
4. **Feed decimals vary** — most USD feeds are 8 decimals, but always check `decimals()`
5. **Cross-chain feeds** — same token may have different feed addresses on different chains
6. **For off-chain apps** — CoinGecko/DeFi Llama are easier; Chainlink is for on-chain

## Links

- Chainlink Data Feeds: https://data.chain.link
- Chainlink Docs: https://docs.chain.link/data-feeds
- Chainlink GitHub: https://github.com/smartcontractkit/chainlink
- Pyth Network: https://pyth.network
- Sperax (uses Chainlink for USDs): https://docs.chat.sperax.io
