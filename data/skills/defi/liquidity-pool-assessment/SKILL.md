---
name: liquidity-pool-assessment
description: Evaluate liquidity pools across DeFi protocols by analyzing depth, fee structures, volume trends, and risk-reward profiles to determine optimal liquidity provision strategies.
license: MIT
metadata:
  category: defi
  difficulty: intermediate
  author: sperax-team
  tags: [defi, liquidity, pools, amm, lp]
---

# Liquidity Pool Assessment

## When to use this skill

Use when the user asks about:
- Evaluating whether to provide liquidity to a specific pool
- Comparing liquidity pools across protocols or chains
- Understanding LP fee earnings potential
- Analyzing pool depth and slippage characteristics
- Concentrated liquidity range selection (Uniswap V3 style)

## Assessment Methodology

### 1. Pool Identification

Collect baseline information:
- Protocol and chain (e.g., Uniswap V3 on Ethereum, Curve on Arbitrum)
- Pool type: constant product (x*y=k), stableswap, concentrated liquidity, or weighted
- Token pair composition and fee tier
- Contract address and verification status

### 2. Liquidity Depth Analysis

Evaluate the pool's liquidity characteristics:
- **Total TVL** and trend over 7d/30d
- **Liquidity distribution** — for concentrated liquidity pools, analyze where liquidity is clustered relative to current price
- **Top LP concentration** — what percentage of liquidity is from the top 5 LPs? High concentration means exit risk if large LPs withdraw
- **Historical liquidity stability** — has TVL been steady or volatile?

### 3. Volume and Fee Analysis

Assess revenue potential:
- **24h, 7d, 30d trading volume** and trend direction
- **Fee tier** and effective fee rate
- **Fee APR** derived from actual volume (not projected)
- **Volume-to-TVL ratio** — higher ratio means better capital efficiency for LPs
- **Volume source** — organic trading vs arbitrage vs MEV

### 4. Price Impact and Slippage

Model trade execution quality:
- Slippage for standard trade sizes ($1K, $10K, $100K, $1M)
- Compare to competing pools for the same pair
- Identify if the pool is the primary routing destination on aggregators

### 5. Risk Evaluation

| Risk | Assessment |
|------|------------|
| Impermanent loss | Estimate based on pair correlation and volatility |
| Smart contract risk | Audit status, bug bounty program, incident history |
| Concentration risk | Single large LP withdrawal impact |
| Protocol risk | Governance changes, fee switch proposals |
| Inventory risk | For concentrated positions — price moving out of range |

### 6. Concentrated Liquidity Strategy (if applicable)

When the pool uses concentrated liquidity:
- Recommend a price range based on historical volatility
- Calculate capital efficiency multiplier vs full-range
- Estimate rebalancing frequency and associated gas costs
- Suggest whether active management or passive full-range is better given the user's time commitment

### 7. Output Format

Present findings as:
- **Pool**: Protocol / Pair / Fee Tier
- **TVL**: Current value and 30d trend
- **Fee APR**: Based on actual volume
- **Volume/TVL ratio**: Assessment of capital efficiency
- **Liquidity quality**: Deep / Adequate / Thin
- **Risk level**: Low / Medium / High
- **Recommendation**: Provide / Avoid / Provide with conditions
- **Optimal strategy**: Full range vs concentrated range with specific bounds
- **Position size guidance**: Suggested allocation relative to portfolio
