---
name: uniswap-v3-guide
description: Comprehensive guide to Uniswap V3 including concentrated liquidity mechanics, range selection strategies, fee tier optimization, and position management best practices.
license: MIT
metadata:
  category: protocol
  difficulty: advanced
  author: sperax-team
  tags: [protocol, uniswap, v3, concentrated-liquidity, dex]
---

# Uniswap V3 Guide

## When to use this skill

Use when the user asks about:
- How Uniswap V3 works
- Providing liquidity on Uniswap V3
- Choosing fee tiers on Uniswap
- Setting price ranges for concentrated liquidity
- Managing or adjusting an existing Uniswap V3 position
- Comparing Uniswap V3 to other DEXs

## Protocol Knowledge

### 1. Uniswap V3 Core Concepts

Key innovations over V2:
- **Concentrated liquidity**: LPs provide liquidity within a custom price range instead of across the entire curve (0 to infinity)
- **Capital efficiency**: A narrow range provides the same depth as a much larger V2 position — up to 4000x more efficient
- **Multiple fee tiers**: 0.01%, 0.05%, 0.3%, 1% — different tiers for different pair types
- **NFT positions**: Each LP position is unique (specific range, fee tier) — represented as an NFT, not fungible ERC-20 LP tokens
- **Active management**: Positions earn fees only when price is within range — requires monitoring

### 2. Fee Tier Selection

Match fee tier to pair characteristics:

| Fee Tier | Best For | Examples |
|----------|---------|---------|
| 0.01% | Stablecoin pairs with minimal price deviation | USDC/USDT, DAI/USDC |
| 0.05% | Correlated pairs with low volatility | ETH/stETH, WBTC/renBTC |
| 0.30% | Standard pairs with moderate volatility | ETH/USDC, WBTC/ETH |
| 1.00% | Exotic or highly volatile pairs | SHIB/ETH, new token pairs |

Check which fee tier has the most TVL for the pair — that's usually the primary trading venue.

### 3. Range Selection Strategy

Choosing the right price range is the most critical decision:

**Wide range (±30-50% from current price)**:
- Lower capital efficiency but less active management
- Lower risk of price going out of range
- Suitable for volatile pairs or passive LPs
- Similar fee earnings to a smaller V2 position

**Medium range (±10-20% from current price)**:
- Balanced capital efficiency and management effort
- Good for pairs with moderate daily volatility
- Likely needs adjustment every 1-4 weeks

**Narrow range (±2-5% from current price)**:
- Maximum capital efficiency — earn maximum fees per dollar deposited
- Very high impermanent loss if price moves out of range
- Requires daily or even hourly monitoring
- Best for stable pairs or professional market makers

**Range calibration method**:
1. Pull 30-day price history for the pair
2. Calculate the standard deviation of daily returns
3. Set range to approximately ±2 standard deviations for moderate confidence
4. Widen range if you want less management, narrow if you want more efficiency

### 4. Position Management

Ongoing LP management tasks:
- **Monitor range**: If price is near the edge of your range, decide whether to adjust
- **Collect fees**: Fees accrue inside the position — collect periodically (costs gas)
- **Rebalance**: If price exits range, the position is 100% in one token and earns no fees. Options:
  - Wait for price to return to range
  - Remove liquidity and create a new position centered on current price
  - Factor in gas costs — sometimes waiting is cheaper than rebalancing
- **Compound earnings**: Periodically add collected fees back to the position

### 5. Impermanent Loss in V3

IL is amplified in concentrated positions:
- IL scales inversely with range width
- A position with ±5% range has roughly 10x the IL of a full-range position at the same price move
- When price exits the range entirely, you're left with 100% of the depreciating token
- For stable pairs with narrow ranges, IL is minimal as long as the peg holds

### 6. Gas Cost Awareness

On Ethereum mainnet:
- Creating a position: ~300K-500K gas
- Adding liquidity: ~200K-400K gas
- Removing liquidity: ~200K-300K gas
- Collecting fees: ~100K-150K gas
- Swapping: ~150K-250K gas

Consider L2 deployments (Arbitrum, Optimism, Base, Polygon) for smaller positions where mainnet gas would eat into returns.

### 7. Output Format

When advising on a Uniswap V3 position:
- **Pair**: Token pair and chain
- **Fee tier**: Recommended tier with reasoning
- **Price range**: Lower and upper bounds with rationale
- **Capital efficiency**: Multiplier vs full-range
- **Expected fee APR**: Based on current volume and position concentration
- **IL risk**: Estimated IL at ±10%, ±25% price movement
- **Management frequency**: How often to check/adjust
- **Gas budget**: Estimated costs for position management
- **Alternative**: Whether a V2-style position or different DEX might be simpler
