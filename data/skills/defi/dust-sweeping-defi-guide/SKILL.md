---
name: dust-sweeping-defi-guide
description: Guide to DeFi dust sweeping strategies — identifying and consolidating small token balances across wallets and chains. Covers gas-efficient batching, threshold calculations, yield deployment of swept dust, and integration with Sperax USDs auto-rebase.
license: MIT
metadata:
  category: defi
  difficulty: intermediate
  author: nich
  tags: [defi, dust-sweeping-defi-guide]
---

# DeFi Dust Sweeping Guide

Dust = small token balances scattered across wallets and chains that individually aren't worth the gas to move. This guide covers strategies to identify, consolidate, and redeploy dust efficiently.

## What Is Dust?

| Token Type | Dust Threshold | Why It Exists |
|-----------|---------------|--------------|
| **ERC-20** | < $5 in value | Partial swaps, airdrops, leftovers |
| **Native tokens** | < $1 | Gas refunds, micro-payments |
| **LP tokens** | < $10 | Withdrawn positions with dust |
| **Reward tokens** | < $5 | Unclaimed farming rewards |
| **NFT gas refunds** | < $0.50 | Failed mint refunds |

## Dust Detection

### Scan All Tokens

```typescript
import { DustScanner } from '@nirholas/dust-sweeper';

const scanner = new DustScanner({
  wallets: ['0xYourWallet'],
  chains: ['ethereum', 'arbitrum', 'base', 'polygon', 'bsc'],
  dustThreshold: 5.00  // USD value below which = dust
});

const dust = await scanner.scan();
console.log(`Found ${dust.totalTokens} dust tokens worth $${dust.totalValue}`);
```

### Results

```json
{
  "totalTokens": 47,
  "totalValue": 82.50,
  "byChain": {
    "ethereum": { "tokens": 12, "value": 35.00, "gasToSweep": 8.50 },
    "arbitrum": { "tokens": 18, "value": 28.00, "gasToSweep": 0.15 },
    "polygon": { "tokens": 10, "value": 12.00, "gasToSweep": 0.05 },
    "bsc": { "tokens": 7, "value": 7.50, "gasToSweep": 0.08 }
  }
}
```

## Sweep Strategies

### 1. Gas-Efficient Batch Sweep

```typescript
const strategy = scanner.calculateStrategy({
  target: 'USDs',              // Convert all dust to USDs
  targetChain: 'arbitrum',     // Consolidate on Arbitrum
  minProfitRatio: 0.7,         // Only sweep if 70%+ profit after gas
  batchSize: 10,               // Batch 10 approvals per tx
  useMulticall: true           // Use Multicall3 for batching
});
```

### 2. Same-Chain Consolidation

| Strategy | Gas Efficiency | Speed |
|----------|---------------|-------|
| **Multicall batch** | ★★★★★ | Fast |
| **DEX aggregator** | ★★★★ | Fast |
| **1inch Fusion** | ★★★★★ | Slow (gasless) |
| **Individual swaps** | ★ | Fast |

### 3. Cross-Chain Sweep

```
Polygon dust ($12) → Bridge → Arbitrum
BSC dust ($7.50) → Bridge → Arbitrum
Ethereum dust ($35) → Bridge → Arbitrum
                                  │
                                  ▼
                        Convert to USDs on Arbitrum
                                  │
                                  ▼
                        Hold USDs (earn 5-10% auto-yield)
```

## Profitability Calculator

```typescript
const analysis = scanner.analyzeProfitability(dust);

analysis.forEach(token => {
  console.log(
    `${token.symbol}: $${token.value} | ` +
    `Gas: $${token.gasToSwap} | ` +
    `Profit: $${token.netProfit} | ` +
    `${token.profitable ? '✅' : '❌'}`
  );
});
```

## Deploy to Yield

After sweeping dust to USDs on Arbitrum:

| Option | APY | Risk |
|--------|-----|------|
| **Hold USDs** | 5-10% | Low (auto-rebase) |
| **SPA staking** | Variable | Medium |
| **Sperax Farms** | 10-30% | Medium |
| **Plutus Vaults** | 15-40% | Medium-High |

## Automated Dust Sweeping

```typescript
// Set up automated sweeping
const scheduler = new DustScheduler({
  wallet: '0xYourWallet',
  chains: ['arbitrum', 'polygon', 'bsc'],
  schedule: 'weekly',
  dustThreshold: 5.00,
  target: 'USDs',
  targetChain: 'arbitrum',
  minProfitRatio: 0.7,
  notification: 'telegram'
});

scheduler.start();
```

## Links

- GitHub: https://github.com/nirholas/dust-sweeper
- Sperax USDs: https://app.sperax.io
- Multicall3: https://www.multicall3.com
