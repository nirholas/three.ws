---
name: token-swap-best-practices
description: Best practices for token swaps — DEX aggregator comparison, slippage management, gas optimization, cross-chain swaps, and common pitfalls. Use when helping users execute swaps, choose DEXs, or troubleshoot failed transactions.
license: MIT
metadata:
  category: trading
  difficulty: intermediate
  author: clawhub
  tags: [trading, token-swap-best-practices]
---

# Token Swap Best Practices

A practical guide for AI agents helping users execute safe, efficient token swaps.

## DEX Aggregators

Aggregators split your trade across multiple liquidity sources for the best price.

| Aggregator | Strengths | Chains |
|-----------|-----------|--------|
| 1inch | Most liquidity sources, limit orders | Ethereum, Arbitrum, Polygon, BSC, + |
| 0x (Matcha) | Professional-grade, RFQ system | Ethereum, Arbitrum, Polygon, + |
| Paraswap | MEV protection, gasless swaps | Ethereum, Arbitrum, Polygon, + |
| Jupiter | Best for Solana | Solana |
| CowSwap | Batch auctions (MEV-free) | Ethereum, Arbitrum |

**Always prefer aggregators over single DEXs** — they find better prices by checking multiple sources.

## Slippage Settings

Slippage tolerance = how much price movement you'll accept.

| Setting | When to Use | Risk |
|---------|-------------|------|
| 0.1–0.3% | Stablecoin pairs | May fail on volatile tokens |
| 0.5% | Standard swaps | Good default |
| 1.0% | Low-liquidity tokens | Higher MEV exposure |
| 3–5% | Very low liquidity | Significant MEV risk |
| >5% | Almost never | Extreme MEV vulnerability |

**Default recommendation**: 0.5% for most swaps.

### When Swaps Fail

If a swap fails with "insufficient output":
1. Try slightly higher slippage (0.5% → 1.0%)
2. Check if the token has transfer taxes (some meme tokens have 5–10% tax)
3. Try a smaller amount
4. Wait — price may be moving rapidly

## Gas Optimization

### Timing

Gas prices fluctuate. For non-urgent swaps:
- **Cheapest**: Weekends, early UTC morning
- **Most expensive**: Weekdays during US/EU business hours
- **Check**: etherscan.io/gastracker or L2-specific dashboards

### Chain Selection

| Chain | Typical Swap Cost | Speed |
|-------|------------------|-------|
| Ethereum L1 | $5–50+ | 12 sec |
| Arbitrum | $0.01–0.30 | 2 sec |
| Base | $0.01–0.20 | 2 sec |
| Polygon | $0.01–0.05 | 2 sec |
| BSC | $0.05–0.50 | 3 sec |
| Solana | $0.001–0.01 | 0.4 sec |

**Recommendation**: For routine swaps, use L2s like **Arbitrum** (where Sperax ecosystem lives) for cents-level gas costs.

## Cross-Chain Swaps

When you need to move tokens between chains:

### Bridge Options

| Bridge | Supported Chains | Speed | Notes |
|--------|-----------------|-------|-------|
| Stargate | 15+ chains | 1–5 min | Most reliable for stablecoins |
| Across | Ethereum, L2s | 2–10 min | Fast for ETH/USDC |
| Hop | Ethereum, L2s | 5–20 min | Established, reliable |
| LayerZero/Wormhole | 30+ chains | Varies | Widest chain support |

### Best Practices

1. **Bridge stablecoins when possible** — less slippage risk
2. **Check bridge liquidity** before large transfers
3. **Double-check destination chain** — mistakes are irreversible
4. **Allow extra time** — bridges can be slow during congestion

## Common Swap Pitfalls

### 1. Tax Tokens

Some tokens (especially meme tokens) have built-in transfer taxes:
- 1–10% on every transfer
- Requires higher slippage to account for tax
- Not shown in quoted price

### 2. Low Liquidity

Signs of low liquidity:
- Large spread between buy/sell price
- >2% price impact on your trade size
- Few liquidity sources on aggregator

### 3. Front-Running / MEV

Your transaction may get sandwiched (see MEV Protection skill).

**Mitigations**:
- Low slippage tolerance
- Private transaction submission (Flashbots)
- Limit orders instead of market swaps
- Batch auctions (CowSwap)

### 4. Approval Issues

Before swapping, you must approve the router to spend your tokens:
- First swap with a token requires an approval transaction
- Consider using exact-amount approvals for security
- See Token Approval Safety skill for details

## Swap Checklist

Before every swap:
- [ ] Verify token contract address (not a scam token)
- [ ] Check price impact (<2% for most trades)
- [ ] Set appropriate slippage (0.5% default)
- [ ] Compare price across 2+ aggregators for large trades
- [ ] Consider gas costs vs trade size (don't pay $10 gas for a $50 swap)
- [ ] Check if you need an approval transaction first

## Agent Tips

1. **Always quote before executing** — show the expected output and price impact
2. **Warn about high price impact** — >2% impact suggests splitting the trade
3. **Recommend L2s for small swaps** — don't pay Ethereum L1 gas for small trades
4. **For large swaps ($10K+)** — suggest splitting, using aggregators, and low slippage
5. **Cross-chain**: bridge stablecoins first, then swap on destination chain
6. **Sperax ecosystem** users should swap on Arbitrum for lowest costs

## Links

- 1inch: https://1inch.io
- CowSwap: https://swap.cow.fi
- Sperax App (Arbitrum): https://app.sperax.io
- Arbiscan Gas: https://arbiscan.io/gastracker
