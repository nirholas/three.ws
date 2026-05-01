---
name: mev-protection-guide
description: Guide to MEV (Maximal Extractable Value) — sandwich attacks, frontrunning, backrunning, and how to protect transactions. Use when explaining MEV to users, recommending swap protection, or analyzing suspicious transaction patterns.
license: MIT
metadata:
  category: security
  difficulty: intermediate
  author: clawhub
  tags: [security, mev-protection-guide]
---

# MEV Protection Guide

MEV (Maximal Extractable Value) is profit that block builders and searchers extract by reordering, including, or excluding transactions. Understanding MEV helps protect your users' trades.

## Types of MEV

### 1. Sandwich Attacks

The most common MEV attack on DEX swaps:

```
1. Attacker sees your swap in mempool
2. Attacker buys before you (frontrun) → pushes price up
3. Your swap executes at a worse price
4. Attacker sells after you (backrun) → profits from the price difference
```

**Who gets hurt**: Anyone swapping on DEXs with high slippage tolerance
**Typical loss**: 0.3–2% of trade value

### 2. Frontrunning

A searcher copies your profitable transaction and submits it first with higher gas:
- Arbitrage opportunities
- NFT mints
- Liquidation calls

### 3. Backrunning

Searcher submits a transaction immediately after yours to capture resulting arbitrage:
- After large swaps (price impact creates arb opportunity)
- After oracle updates
- After liquidations

### 4. Just-In-Time (JIT) Liquidity

A sophisticated attack on V3 pools:
1. Searcher adds concentrated liquidity just before your swap
2. Your swap pays fees to the searcher's position
3. Searcher removes liquidity immediately after

### 5. Time-Bandit Attacks

Block proposers reorganize past blocks to capture MEV. Rare but possible with proof-of-stake.

## Protection Strategies

### For Users

| Strategy | Protection Level | Tradeoff |
|----------|-----------------|----------|
| Low slippage (0.5%) | Medium | May fail on volatile tokens |
| Private mempool | High | May have slight delay |
| DEX aggregator | Medium–High | Best price routing |
| Limit orders | High | No immediate execution |

### 1. Use Low Slippage Tolerance

Set slippage to 0.5% or lower. This limits how much the price can move against you, making sandwich attacks unprofitable.

**Caution**: Too-low slippage on volatile tokens may cause transactions to fail.

### 2. Private Transaction Submission

Send transactions through private mempools that hide them from searchers:

| Service | How It Works |
|---------|-------------|
| Flashbots Protect | Sends tx directly to block builders, skipping public mempool |
| MEV Blocker | Private relay by CoW Protocol |
| MEV Shield (Sperax) | Built-in protection in SperaxOS swap tool |

### 3. Use DEX Aggregators

Aggregators like 1inch, 0x, and Paraswap split trades across pools to minimize price impact and MEV exposure.

### 4. Gasless Limit Orders

Place limit orders that execute when conditions are met — no mempool exposure:
- **1inch Limit Order Protocol**: EIP-712 signed, gasless
- No frontrunning possible (order isn't in mempool)

### 5. Batch Auctions

Protocols like CoW Swap use batch auctions where all trades in a batch get the same price, preventing sandwich attacks entirely.

## Detecting MEV

### Signs of a Sandwich Attack

Look for this pattern around your transaction:
1. Large buy of the same token (1–2 blocks before yours)
2. Your swap (at a worse price than expected)
3. Large sell of the same token (same block or next block)
4. Same address in steps 1 and 3

### Checking Transaction Impact

```
Expected output (from quote): 1,000 USDC
Actual output (on-chain):       985 USDC
Difference:                      15 USDC (1.5% slippage/MEV)
```

If actual slippage significantly exceeds the pool's fee tier, MEV extraction is likely.

## MEV by Chain

| Chain | MEV Level | Notes |
|-------|-----------|-------|
| Ethereum | High | Most MEV activity, Flashbots dominant |
| Arbitrum | Low–Medium | Sequencer ordering reduces MEV, but still possible |
| Base | Low–Medium | Similar to Arbitrum |
| Polygon | Medium | Less sophisticated but growing |
| BSC | Medium | MEV searchers active |
| Solana | Medium–High | Jito MEV ecosystem |

**Arbitrum advantage**: The centralized sequencer orders transactions FIFO (first-in-first-out), which significantly reduces sandwich attack opportunities. This is one reason Sperax chose Arbitrum for USDs.

## Agent Tips

When helping users with swaps:
1. **Always recommend low slippage** — 0.5% for standard swaps
2. **Large swaps** (>$10K) should use private mempools or DEX aggregators
3. **Check if their wallet supports Flashbots Protect** — many do now
4. **On Arbitrum**: MEV is lower but not zero — still use reasonable slippage
5. **If a swap fails**: suggest slightly higher slippage but explain the tradeoff
6. **Limit orders**: for non-urgent trades, gasless limit orders eliminate MEV entirely

## Links

- Flashbots Protect: https://protect.flashbots.net
- MEV Blocker: https://mevblocker.io
- Sperax (Arbitrum-native, lower MEV): https://app.sperax.io
- EigenPhi (MEV analytics): https://eigenphi.io
